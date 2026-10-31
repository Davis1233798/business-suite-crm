import { NextRequest } from "next/server";
import { resolveTenantContext } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { CrmService } from "@/lib/services/crm-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    const body: any = await request.json();

    const result = await CrmService.convertLead(context, {
      leadId: body.leadId,
      dealAmount: body.dealAmount,
      closeDate: body.closeDate,
    });

    return successResponse(result, context.requestId);
  } catch (err: any) {
    return errorResponse("CONVERT_FAILED", err.message, 400);
  }
}
