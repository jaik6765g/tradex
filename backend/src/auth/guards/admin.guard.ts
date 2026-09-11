import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Observable } from 'rxjs';

interface AdminRequestUser {
  role?: string;
}

interface AdminRequest {
  user?: AdminRequestUser;
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const user = request.user;
    return user?.role === 'admin';
  }
}
