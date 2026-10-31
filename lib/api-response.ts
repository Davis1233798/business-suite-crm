import { NextResponse } from "next/server";

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  request_id: string;
}

export function generateRequestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function successResponse<T>(
  data: T,
  requestId: string = generateRequestId(),
  status: number = 200
): NextResponse<ApiResponse<T>> {
  return NextResponse.json(
    {
      success: true,
      data,
      request_id: requestId,
    },
    {
      status,
      headers: {
        "x-request-id": requestId,
      },
    }
  );
}

export function errorResponse(
  code: string,
  message: string,
  status: number = 400,
  details?: any,
  requestId: string = generateRequestId()
): NextResponse<ApiResponse<never>> {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        details,
      },
      request_id: requestId,
    },
    {
      status,
      headers: {
        "x-request-id": requestId,
      },
    }
  );
}
