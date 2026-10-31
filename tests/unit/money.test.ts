import test from "node:test";
import assert from "node:assert";
import {
  calculateOrderAmounts,
  calculateDiningAmounts,
  calculateMovingAverage,
  calculateOee,
  calculateSlaDueDate,
} from "../../lib/money.ts";

test("Order amounts calculation: P02 & S04 & Discount allocation", () => {
  // POS P02: 商品100×2，折10後190
  const posOrder = calculateOrderAmounts({
    lines: [{ unitPrice: 100, quantity: 2, lineDiscount: 10 }],
  });
  assert.strictEqual(posOrder.subtotal, 200);
  assert.strictEqual(posOrder.lineDiscountTotal, 10);
  assert.strictEqual(posOrder.totalAmount, 190);

  // Shop S04: 100×2打9折=180，加運費60=240
  const shopOrder = calculateOrderAmounts({
    lines: [{ unitPrice: 100, quantity: 2 }],
    orderDiscount: 20, // 10% discount on 200 = 20
    shippingOrServiceFee: 60,
  });
  assert.strictEqual(shopOrder.subtotal, 200);
  assert.strictEqual(shopOrder.orderDiscountTotal, 20);
  assert.strictEqual(shopOrder.netSubtotal, 180);
  assert.strictEqual(shopOrder.shippingOrServiceFee, 60);
  assert.strictEqual(shopOrder.totalAmount, 240);

  // Discount allocation across multiple lines with remainder check
  const multiLine = calculateOrderAmounts({
    lines: [
      { unitPrice: 100, quantity: 1 }, // 100
      { unitPrice: 100, quantity: 1 }, // 100
      { unitPrice: 100, quantity: 1 }, // 100
    ],
    orderDiscount: 10, // 10 split over 3 items -> 3, 3, 4
  });
  assert.strictEqual(multiLine.totalAmount, 290);
  const allocatedSum = multiLine.lines.reduce(
    (acc, l) => acc + l.allocatedOrderDiscount,
    0
  );
  assert.strictEqual(allocatedSum, 10);
  assert.deepStrictEqual(
    multiLine.lines.map((l) => l.allocatedOrderDiscount),
    [3, 3, 4]
  );
});

test("Dining amounts calculation: D07 (餐點100+200，10%服務費=30、總額330)", () => {
  const result = calculateDiningAmounts({
    subtotal: 300,
    serviceFeeRatePercent: 10,
  });
  assert.strictEqual(result.subtotal, 300);
  assert.strictEqual(result.serviceCharge, 30);
  assert.strictEqual(result.finalAmount, 330);
});

test("ERP Moving average cost: E08 (10件@100再10件@200，均價150，出4成本600、餘值2400)", () => {
  // Step 1: 10 pieces @ 100
  const step1 = calculateMovingAverage({
    currentQty: 0,
    currentTotalCost: 0,
    incomingQty: 10,
    incomingUnitCost: 100,
  });
  assert.strictEqual(step1.totalQuantity, 10);
  assert.strictEqual(step1.unitCost, 100);
  assert.strictEqual(step1.totalCost, 1000);

  // Step 2: add 10 pieces @ 200
  const step2 = calculateMovingAverage({
    currentQty: step1.totalQuantity,
    currentTotalCost: step1.totalCost,
    incomingQty: 10,
    incomingUnitCost: 200,
  });
  assert.strictEqual(step2.totalQuantity, 20);
  assert.strictEqual(step2.totalCost, 3000);
  assert.strictEqual(step2.unitCost, 150);

  // Ship 4 items at cost 150
  const shippedQty = 4;
  const costOfGoodsSold = shippedQty * step2.unitCost;
  const remainingQty = step2.totalQuantity - shippedQty;
  const remainingValue = remainingQty * step2.unitCost;

  assert.strictEqual(costOfGoodsSold, 600);
  assert.strictEqual(remainingQty, 16);
  assert.strictEqual(remainingValue, 2400);
});

test("MES OEE calculation: M08 (排程480分、運轉360分、理論1分/件、總量300、良品270，OEE=56.25%)", () => {
  const result = calculateOee({
    plannedMinutes: 480,
    operatingMinutes: 360,
    idealCycleMinutesPerUnit: 1,
    totalPieces: 300,
    goodPieces: 270,
  });

  assert.strictEqual(result.hasData, true);
  assert.strictEqual(result.availabilityPercent, 75); // 360/480 = 75%
  assert.strictEqual(Number(result.performancePercent?.toFixed(3)), 83.333); // (300/360)*100
  assert.strictEqual(result.qualityPercent, 90); // 270/300 = 90%
  assert.strictEqual(result.oeePercent, 56.25); // 0.75 * (300/360) * 0.9 = 56.25%

  // Denominator 0 handling
  const zeroData = calculateOee({
    plannedMinutes: 0,
    operatingMinutes: 0,
    idealCycleMinutesPerUnit: 0,
    totalPieces: 0,
    goodPieces: 0,
  });
  assert.strictEqual(zeroData.hasData, false);
  assert.strictEqual(zeroData.oeePercent, null);
});

test("CRM SLA calculation: R06 (skips weekend)", () => {
  // Friday 15:00 with 6 hour SLA (business hours 09:00 - 18:00)
  // Friday 15:00 to 18:00 = 3 hours used
  // Saturday & Sunday skipped
  // Monday 09:00 to 12:00 = remaining 3 hours
  // Expected completion: Monday 12:00
  const friday3pm = new Date("2026-10-30T15:00:00Z"); // Oct 30 2026 is Friday
  const slaResult = calculateSlaDueDate(friday3pm, 6, 9, 18);

  assert.strictEqual(slaResult.getUTCDay(), 1); // Monday
  assert.strictEqual(slaResult.getUTCHours(), 12);
  assert.strictEqual(slaResult.getUTCMinutes(), 0);
});
