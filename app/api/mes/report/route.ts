import { NextRequest } from "next/server";
import { resolveTenantContext } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { MesService } from "@/lib/services/mes-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    const body: any = await request.json();

    const result = await MesService.reportProduction(context, {
      workOrderId: body.workOrderId,
      operationId: body.operationId,
      goodQuantity: Number(body.goodQuantity || 0),
      scrapQuantity: Number(body.scrapQuantity || 0),
      notes: body.notes,
      idempotencyKey: body.idempotencyKey,
    });

    return successResponse(result, context.requestId);
  } catch (err: any) {
    return errorResponse("REPORT_FAILED", err.message, 400);
  }
}
