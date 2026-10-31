/**
 * Financial calculations, rounding rules, and pricing invariants.
 * All amounts are represented in integer minor units (e.g. cents or TWD dollars).
 * Strict calculation sequence:
 * Line Amount -> Line Discount -> Order Discount Allocation -> Tax -> Shipping/Service Charge
 */

export interface LineItemInput {
  id?: string;
  unitPrice: number; // Integer (cents)
  quantity: number; // Integer
  lineDiscount?: number; // Integer (cents)
}

export interface CalculatedLineItem {
  id?: string;
  unitPrice: number;
  quantity: number;
  lineSubtotal: number; // unitPrice * quantity
  lineDiscount: number;
  lineTotal: number; // lineSubtotal - lineDiscount
  allocatedOrderDiscount: number;
  netLineTotal: number; // lineTotal - allocatedOrderDiscount
}

export interface OrderCalculationResult {
  lines: CalculatedLineItem[];
  subtotal: number; // Sum of lineSubtotals
  lineDiscountTotal: number; // Sum of line discounts
  orderDiscountTotal: number; // Order level discount
  netSubtotal: number; // subtotal - lineDiscountTotal - orderDiscountTotal
  taxAmount: number;
  shippingOrServiceFee: number;
  totalAmount: number; // netSubtotal + taxAmount + shippingOrServiceFee
}

/**
 * Calculates a complete order with exact integer cent allocations.
 */
export function calculateOrderAmounts(params: {
  lines: LineItemInput[];
  orderDiscount?: number; // Integer discount for the entire order
  taxRateBps?: number; // Basis points (e.g., 500 = 5%)
  taxInclusive?: boolean;
  shippingOrServiceFee?: number;
}): OrderCalculationResult {
  const {
    lines,
    orderDiscount = 0,
    taxRateBps = 0,
    taxInclusive = false,
    shippingOrServiceFee = 0,
  } = params;

  // 1. Line amount and line discount
  let subtotal = 0;
  let lineDiscountTotal = 0;

  const calculatedLines: CalculatedLineItem[] = lines.map((line) => {
    const unitPrice = Math.max(0, Math.floor(line.unitPrice));
    const quantity = Math.max(0, Math.floor(line.quantity));
    const lineSubtotal = unitPrice * quantity;
    const requestedDiscount = Math.max(0, Math.floor(line.lineDiscount || 0));
    const actualLineDiscount = Math.min(lineSubtotal, requestedDiscount);
    const lineTotal = lineSubtotal - actualLineDiscount;

    subtotal += lineSubtotal;
    lineDiscountTotal += actualLineDiscount;

    return {
      id: line.id,
      unitPrice,
      quantity,
      lineSubtotal,
      lineDiscount: actualLineDiscount,
      lineTotal,
      allocatedOrderDiscount: 0,
      netLineTotal: lineTotal,
    };
  });

  const rawLineTotalSum = subtotal - lineDiscountTotal;
  const applicableOrderDiscount = Math.min(rawLineTotalSum, Math.max(0, Math.floor(orderDiscount)));

  // 2. Order discount allocation across lines with remainder correction
  if (applicableOrderDiscount > 0 && rawLineTotalSum > 0) {
    let allocatedTotal = 0;
    const count = calculatedLines.length;

    for (let i = 0; i < count; i++) {
      const line = calculatedLines[i];
      if (i === count - 1) {
        // Last line absorbs remainder
        line.allocatedOrderDiscount = applicableOrderDiscount - allocatedTotal;
      } else {
        const share = Math.floor(
          (line.lineTotal * applicableOrderDiscount) / rawLineTotalSum
        );
        line.allocatedOrderDiscount = share;
        allocatedTotal += share;
      }
      line.netLineTotal = line.lineTotal - line.allocatedOrderDiscount;
    }
  }

  const netSubtotal = rawLineTotalSum - applicableOrderDiscount;

  // 3. Tax calculation
  let taxAmount = 0;
  if (taxRateBps > 0) {
    if (taxInclusive) {
      // Net includes tax: tax = netSubtotal * rate / (10000 + rate)
      taxAmount = Math.round((netSubtotal * taxRateBps) / (10000 + taxRateBps));
    } else {
      // Tax added on top
      taxAmount = Math.round((netSubtotal * taxRateBps) / 10000);
    }
  }

  // 4. Shipping or Service Fee
  const safeFee = Math.max(0, Math.floor(shippingOrServiceFee));

  // 5. Total amount
  const totalAmount = taxInclusive
    ? netSubtotal + safeFee
    : netSubtotal + taxAmount + safeFee;

  return {
    lines: calculatedLines,
    subtotal,
    lineDiscountTotal,
    orderDiscountTotal: applicableOrderDiscount,
    netSubtotal,
    taxAmount,
    shippingOrServiceFee: safeFee,
    totalAmount: Math.max(0, totalAmount),
  };
}

/**
 * Dining bill calculation:
 * Subtotal -> Service fee (e.g. 10%) -> Total
 */
export function calculateDiningAmounts(params: {
  subtotal: number;
  serviceFeeRatePercent: number; // e.g. 10 for 10%
  discountAmount?: number;
}) {
  const subtotal = Math.max(0, Math.floor(params.subtotal));
  const discount = Math.min(subtotal, Math.max(0, Math.floor(params.discountAmount || 0)));
  const afterDiscount = subtotal - discount;
  const serviceCharge = Math.round((subtotal * params.serviceFeeRatePercent) / 100);
  const finalAmount = afterDiscount + serviceCharge;

  return {
    subtotal,
    discountAmount: discount,
    serviceCharge,
    finalAmount,
  };
}

/**
 * Moving average inventory cost calculation:
 * Returns the new unit cost and new total value.
 */
export function calculateMovingAverage(params: {
  currentQty: number;
  currentTotalCost: number;
  incomingQty: number;
  incomingUnitCost: number;
}) {
  const currentQty = Math.max(0, params.currentQty);
  const currentTotalCost = Math.max(0, params.currentTotalCost);
  const incomingQty = Math.max(0, params.incomingQty);
  const incomingUnitCost = Math.max(0, params.incomingUnitCost);

  const newQty = currentQty + incomingQty;
  const newTotalCost = currentTotalCost + incomingQty * incomingUnitCost;
  const newAverageUnitCost = newQty > 0 ? Math.round(newTotalCost / newQty) : 0;

  return {
    totalQuantity: newQty,
    totalCost: newTotalCost,
    unitCost: newAverageUnitCost,
  };
}

/**
 * MES OEE calculation:
 * Availability = Operating time / Planned time
 * Performance = (Ideal cycle time * Total pieces) / Operating time
 * Quality = Good pieces / Total pieces
 * OEE = Availability * Performance * Quality
 */
export function calculateOee(params: {
  plannedMinutes: number;
  operatingMinutes: number;
  idealCycleMinutesPerUnit: number;
  totalPieces: number;
  goodPieces: number;
}) {
  const {
    plannedMinutes,
    operatingMinutes,
    idealCycleMinutesPerUnit,
    totalPieces,
    goodPieces,
  } = params;

  if (
    plannedMinutes <= 0 ||
    operatingMinutes <= 0 ||
    totalPieces <= 0 ||
    idealCycleMinutesPerUnit <= 0
  ) {
    return {
      hasData: false,
      availabilityPercent: null,
      performancePercent: null,
      qualityPercent: null,
      oeePercent: null,
      notes: "分母為0，尚無有效生產資料",
    };
  }

  const availability = operatingMinutes / plannedMinutes;
  const performance = (idealCycleMinutesPerUnit * totalPieces) / operatingMinutes;
  const quality = goodPieces / totalPieces;
  const oee = availability * performance * quality;

  return {
    hasData: true,
    availabilityPercent: Number((availability * 100).toFixed(4)),
    performancePercent: Number((performance * 100).toFixed(4)),
    qualityPercent: Number((quality * 100).toFixed(4)),
    oeePercent: Number((oee * 100).toFixed(4)),
    raw: {
      availability,
      performance,
      quality,
      oee,
    },
  };
}

/**
 * CRM SLA Calculation excluding weekends:
 * Calculates target resolution time based on working hours in UTC.
 */
export function calculateSlaDueDate(
  startDate: Date,
  slaHours: number,
  workStartHour: number = 9,
  workEndHour: number = 18
): Date {
  let remainingHours = slaHours;
  let current = new Date(startDate.getTime());

  while (remainingHours > 0) {
    const dayOfWeek = current.getUTCDay(); // 0 is Sunday, 6 is Saturday
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      // Weekend: skip to Monday morning
      current.setUTCDate(current.getUTCDate() + (dayOfWeek === 6 ? 2 : 1));
      current.setUTCHours(workStartHour, 0, 0, 0);
      continue;
    }

    const currentHour = current.getUTCHours() + current.getUTCMinutes() / 60;
    if (currentHour < workStartHour) {
      current.setUTCHours(workStartHour, 0, 0, 0);
      continue;
    }

    if (currentHour >= workEndHour) {
      current.setUTCDate(current.getUTCDate() + 1);
      current.setUTCHours(workStartHour, 0, 0, 0);
      continue;
    }

    const hoursAvailableToday = workEndHour - currentHour;
    if (remainingHours <= hoursAvailableToday) {
      const finalMillis = current.getTime() + remainingHours * 3600 * 1000;
      return new Date(finalMillis);
    } else {
      remainingHours -= hoursAvailableToday;
      current.setUTCDate(current.getUTCDate() + 1);
      current.setUTCHours(workStartHour, 0, 0, 0);
    }
  }

  return current;
}
