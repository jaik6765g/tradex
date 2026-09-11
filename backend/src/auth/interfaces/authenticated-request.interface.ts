import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email?: string;
    walletAddress?: string;
    role?: string;
    status?: string;
  };
}
