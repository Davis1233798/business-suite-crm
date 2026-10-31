import { NextRequest } from "next/server";
import { resolveTenantContext } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ErpService } from "@/lib/services/erp-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    const body: any = await request.json();

    const result = await ErpService.settleInvoicePayment(context, {
      invoiceId: body.invoiceId,
      amount: Number(body.amount || 0),
      paymentMethod: body.paymentMethod || "bank_transfer",
    });

    return successResponse(result, context.requestId);
  } catch (err: any) {
    return errorResponse("PAY_INVOICE_FAILED", err.message, 400);
  }
}
