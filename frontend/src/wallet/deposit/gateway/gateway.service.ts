import { apiClient } from '../../../core/api/client';

import type {
  CreateOrderPayload,
  DepositOrder,
  GatewayConfig,
  OrderStatusResponse,
} from './gateway.types';

export class GatewayService {
  static async createOrder(payload: CreateOrderPayload): Promise<DepositOrder> {
    const { data } = await apiClient.post<DepositOrder>(
      '/deposit-gateway/orders',
      payload,
    );
    return data;
  }

  static async getOrder(orderId: string): Promise<DepositOrder> {
    const { data } = await apiClient.get<DepositOrder>(
      `/deposit-gateway/orders/${orderId}`,
    );
    return data;
  }

  static async getOrderStatus(orderId: string): Promise<OrderStatusResponse> {
    const { data } = await apiClient.get<OrderStatusResponse>(
      `/deposit-gateway/orders/${orderId}/status`,
    );
    return data;
  }

  static async listOrders(): Promise<DepositOrder[]> {
    const { data } = await apiClient.get<DepositOrder[]>(
      '/deposit-gateway/orders',
    );
    return data;
  }

  /**
   * Backend se live pending order — deposit form ke neeche dikhane ke liye.
   * `{ activeOrder: DepositOrder | null }` return hota hai.
   */
  static async getActiveOrder(): Promise<{ activeOrder: DepositOrder | null }> {
    const { data } = await apiClient.get<{ activeOrder: DepositOrder | null }>(
      '/deposit-gateway/orders/active',
    );
    return data;
  }

  static async getConfig(): Promise<GatewayConfig> {
    const { data } = await apiClient.get<GatewayConfig>(
      '/deposit-gateway/config',
    );
    return data;
  }
}
