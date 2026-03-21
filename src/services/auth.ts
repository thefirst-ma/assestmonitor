import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { database } from '../database';
import { User } from '../types';

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';
const JWT_EXPIRES_IN = '7d';

export class AuthService {
  async register(email: string, password: string): Promise<{ user: User; token: string }> {
    if (!email || !password) throw new Error('邮箱和密码不能为空');
    if (password.length < 6) throw new Error('密码至少 6 位');

    const existing = database.getUserByEmail(email);
    if (existing) throw new Error('该邮箱已注册');

    const passwordHash = await bcrypt.hash(password, 10);
    const user = database.createUser(email, passwordHash);
    const token = this.generateToken(user);

    return { user, token };
  }

  async login(email: string, password: string): Promise<{ user: User; token: string }> {
    if (!email || !password) throw new Error('邮箱和密码不能为空');

    const user = database.getUserByEmail(email);
    if (!user) throw new Error('邮箱或密码错误');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new Error('邮箱或密码错误');

    const token = this.generateToken(user);
    return { user, token };
  }

  verifyToken(token: string): { userId: string; email: string } {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as any;
      return { userId: payload.userId, email: payload.email };
    } catch {
      throw new Error('登录已过期，请重新登录');
    }
  }

  private generateToken(user: User): string {
    return jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
  }
}

export const authService = new AuthService();
