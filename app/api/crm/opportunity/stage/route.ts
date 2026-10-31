import { NextRequest } from "next/server";
import { resolveTenantContext } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { CrmService } from "@/lib/services/crm-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    const body: any = await request.json();

    const result = await CrmService.updateOpportunityStage(context, {
      opportunityId: body.opportunityId,
      stageId: body.stageId,
      wonReason: body.wonReason,
      lossReason: body.lossReason,
    });

    return successResponse(result, context.requestId);
  } catch (err: any) {
    return errorResponse("UPDATE_STAGE_FAILED", err.message, 400);
  }
}
