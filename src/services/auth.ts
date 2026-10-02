import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { createHmac, randomInt } from 'crypto';
import { performance } from 'perf_hooks';
import { database, AuthUser } from '../database';
import { User } from '../types';

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'default-secret-change-me') throw new Error('请先配置 JWT_SECRET 后再使用账户功能');
  return secret;
}
const JWT_EXPIRES_IN = '7d';
const RESET_REQUEST_MESSAGE = '如果邮箱已注册，验证码将发送至该邮箱';

export class PasswordResetUnavailableError extends Error {
  constructor() { super('邮件服务暂不可用，请稍后重试'); }
}

export class InvalidPasswordResetCodeError extends Error {
  constructor() { super('验证码无效或已过期，请重新获取'); }
}

export class InvalidSessionError extends Error {
  constructor() { super('登录已过期，请重新登录'); }
}

function resetMailSettings(): { host: string; port: number; user: string; pass: string } {
  const host = (process.env.EMAIL_HOST || '').trim();
  const user = (process.env.EMAIL_USER || '').trim();
  const pass = (process.env.EMAIL_PASS || '').trim();
  const port = Number(process.env.EMAIL_PORT);
  const placeholder = /^(your[-_]|example|changeme|replace[-_])/i;
  if (!host || !user || !pass || !Number.isSafeInteger(port) || port < 1 || port > 65535
    || placeholder.test(host) || placeholder.test(user) || placeholder.test(pass)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)) {
    throw new PasswordResetUnavailableError();
  }
  return { host, port, user, pass };
}

export class AuthService {
  async register(email: string, password: string): Promise<{ user: User; token: string }> {
    jwtSecret();
    email = this.normalizeEmail(email);
    if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('密码至少 8 位，最多 72 字节');

    const existing = await database.getUserByEmail(email);
    if (existing) throw new Error('该邮箱已注册');

    const passwordHash = await bcrypt.hash(password, 10);
    let user: AuthUser;
    try {
      user = await database.createUser(email, passwordHash);
    } catch (error: any) {
      if (error.code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/.test(error.message)) throw new Error('该邮箱已注册');
      throw new Error('注册暂时不可用，请稍后重试');
    }
    const token = this.generateToken(user);

    return { user, token };
  }

  async login(email: string, password: string): Promise<{ user: User; token: string }> {
    email = this.normalizeEmail(email);
    // Legacy accounts could be created before registration enforced bcrypt's
    // 72-byte limit. Let bcrypt verify those existing hashes as it did then.
    if (typeof password !== 'string' || !password) throw new Error('邮箱或密码错误');

    const user = await database.getUserByEmail(email);
    if (!user) throw new Error('邮箱或密码错误');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new Error('邮箱或密码错误');

    const token = this.generateToken(user);
    return { user, token };
  }

  async requestPasswordReset(emailInput: unknown, source: string): Promise<string> {
    const email = this.normalizeEmail(emailInput);
    const settings = resetMailSettings();
    try { jwtSecret(); } catch { throw new PasswordResetUnavailableError(); }
    const sourceHash = createHmac('sha256', jwtSecret()).update(`password-reset-source:v1:${source}`).digest('hex');
    if (!await database.consumePasswordResetSourceQuota(sourceHash, Math.floor(Date.now() / 1000))) {
      return RESET_REQUEST_MESSAGE;
    }
    const startedAt = performance.now();
    const genericResponse = async (): Promise<string> => {
      const remainingMs = 500 - (performance.now() - startedAt);
      if (remainingMs > 0) await new Promise(resolve => setTimeout(resolve, remainingMs));
      return RESET_REQUEST_MESSAGE;
    };
    const user = await database.getUserByEmail(email);
    if (!user) return genericResponse();

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = this.resetCodeHash(user.id, code);
    const reserved = await database.reservePasswordResetCode(user.id, codeHash, Math.floor(Date.now() / 1000));
    if (!reserved) return genericResponse();
    let transporter: ReturnType<typeof nodemailer.createTransport> | undefined;
    let failureCategory = 'SMTP_CONNECT_FAILED';
    try {
      transporter = nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.port === 465,
        requireTLS: settings.port !== 465,
        auth: { user: settings.user, pass: settings.pass },
        tls: { rejectUnauthorized: true },
        connectionTimeout: 5_000,
        greetingTimeout: 5_000,
        socketTimeout: 10_000,
        logger: false,
        debug: false
      });
      failureCategory = 'SMTP_SEND_FAILED';
      const info = await transporter.sendMail({
        from: settings.user,
        to: user.email,
        subject: '投资监控平台密码重置验证码',
        text: `您的验证码是 ${code}。10 分钟内有效，最多可尝试 5 次。若非本人操作，请忽略此邮件。`
      });
      if (!info.accepted?.some((address: string) => address.toLowerCase() === user.email.toLowerCase())) {
        failureCategory = 'SMTP_REJECTED';
        throw new PasswordResetUnavailableError();
      }
      failureCategory = 'RESET_CODE_ACTIVATION_FAILED';
      if (!await database.activatePasswordResetCode(user.id, codeHash)) throw new PasswordResetUnavailableError();
      return genericResponse();
    } catch {
      // A failed send or activation must never leave a usable code behind.
      console.error(`Password reset delivery failed: ${failureCategory}`);
      await database.cancelPasswordResetCode(user.id, codeHash).catch(() => undefined);
      return genericResponse();
    } finally {
      try { transporter?.close(); } catch { /* no sensitive SMTP details in the response */ }
    }
  }

  async confirmPasswordReset(emailInput: unknown, code: unknown, newPassword: unknown, source: string): Promise<void> {
    const email = this.normalizeEmail(emailInput);
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new InvalidPasswordResetCodeError();
    if (typeof newPassword !== 'string' || newPassword.length < 8 || Buffer.byteLength(newPassword, 'utf8') > 72) {
      throw new Error('密码至少 8 位，最多 72 字节');
    }
    const sourceHash = createHmac('sha256', jwtSecret()).update(`password-reset-confirm-source:v1:${source}`).digest('hex');
    if (!await database.consumePasswordResetSourceQuota(sourceHash, Math.floor(Date.now() / 1000))) {
      throw new InvalidPasswordResetCodeError();
    }
    // Hash before checking the account, avoiding a cheap existence probe.
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const user = await database.getUserByEmail(email);
    if (!user) throw new InvalidPasswordResetCodeError();
    const codeHash = this.resetCodeHash(user.id, code);
    const confirmed = await database.confirmPasswordResetCode(user.id, codeHash, passwordHash, Math.floor(Date.now() / 1000));
    if (!confirmed) throw new InvalidPasswordResetCodeError();
  }

  async verifyToken(token: string): Promise<{ userId: string; email: string }> {
    const secret = jwtSecret();
    let payload: any;
    try {
      payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as any;
      if (typeof payload.userId !== 'string' || typeof payload.email !== 'string') throw new Error('Invalid token');
    } catch {
      throw new InvalidSessionError();
    }
    const version = payload.authVersion === undefined ? 0 : payload.authVersion;
    if (!Number.isSafeInteger(version) || version < 0) throw new InvalidSessionError();
    const currentVersion = await database.getAuthVersionByUserId(payload.userId);
    if (currentVersion === undefined || currentVersion !== version) throw new InvalidSessionError();
    return { userId: payload.userId, email: payload.email };
  }

  private generateToken(user: AuthUser): string {
    return jwt.sign(
      { userId: user.id, email: user.email, authVersion: user.authVersion },
      jwtSecret(),
      { expiresIn: JWT_EXPIRES_IN }
    );
  }

  private resetCodeHash(userId: string, code: string): string {
    return createHmac('sha256', jwtSecret()).update(`password-reset:v1:${userId}:${code}`).digest('hex');
  }

  private normalizeEmail(value: unknown): string {
    if (typeof value !== 'string') throw new Error('请输入有效邮箱');
    const email = value.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请输入有效邮箱');
    return email;
  }
}

export const authService = new AuthService();
