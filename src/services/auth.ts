import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { database } from '../database';
import { User } from '../types';

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'default-secret-change-me') throw new Error('请先配置 JWT_SECRET 后再使用账户功能');
  return secret;
}
const JWT_EXPIRES_IN = '7d';

export class AuthService {
  async register(email: string, password: string): Promise<{ user: User; token: string }> {
    jwtSecret();
    email = this.normalizeEmail(email);
    if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('密码至少 8 位，最多 72 字节');

    const existing = await database.getUserByEmail(email);
    if (existing) throw new Error('该邮箱已注册');

    const passwordHash = await bcrypt.hash(password, 10);
    let user: User;
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
    if (typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) throw new Error('邮箱或密码错误');

    const user = await database.getUserByEmail(email);
    if (!user) throw new Error('邮箱或密码错误');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new Error('邮箱或密码错误');

    const token = this.generateToken(user);
    return { user, token };
  }

  verifyToken(token: string): { userId: string; email: string } {
    try {
      const payload = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] }) as any;
      return { userId: payload.userId, email: payload.email };
    } catch {
      throw new Error('登录已过期，请重新登录');
    }
  }

  private generateToken(user: User): string {
    return jwt.sign(
      { userId: user.id, email: user.email },
      jwtSecret(),
      { expiresIn: JWT_EXPIRES_IN }
    );
  }

  private normalizeEmail(value: unknown): string {
    if (typeof value !== 'string') throw new Error('请输入有效邮箱');
    const email = value.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请输入有效邮箱');
    return email;
  }
}

export const authService = new AuthService();
