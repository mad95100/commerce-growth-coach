import type { Browser, Page } from "playwright";

/**
 * The user's journey, step by step. Each step asserts what a garage employee
 * would check with their own eyes: numbers, statuses, stock, history.
 */
export async function journey(browser: Browser, base: string, out: string): Promise<number> {
  const stamp = Date.now();
  const ownerEmail = `owner${stamp}@bsgarage.test`;
  const mechEmail = `mechanic${stamp}@bsgarage.test`;
  const password = "garage-pass-2026";
  const failures: string[] = [];
  let passed = 0;
  const pageErrors: string[] = [];

  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/wa\.me/, (r) => r.fulfill({ status: 200, body: "whatsapp" }));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  ctx.on("page", (p) => {
    if (p !== page) p.close().catch(() => {});
  });

  const shot = (name: string, p: Page = page) => p.screenshot({ path: `${out}/${name}.png`, fullPage: true });

  async function step(name: string, fn: () => Promise<void>) {
    // Steps build on each other: after a failure, the rest is not meaningful.
    if (failures.length) return;
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      const msg = (e as Error).message.split("\n")[0];
      failures.push(`${name}: ${msg}`);
      console.log(`  ✗ ${name}\n      ${msg}`);
      await shot(`FAIL-${name.replace(/\W+/g, "_").slice(0, 60)}`).catch(() => {});
    }
  }
  const see = (text: string | RegExp, p: Page = page) => p.getByText(text).first().waitFor({ timeout: 10_000 });
  // When a modal is open, only its buttons are clickable: target it first.
  const click = async (name: string | RegExp, p: Page = page) => {
    const dialog = p.locator("dialog[open]");
    if (await dialog.count()) return dialog.getByRole("button", { name }).first().click();
    return p.getByRole("button", { name }).first().click();
  };
  const go = async (path: string, p: Page = page) => {
    await p.goto(base + path);
    // Convenience only: every step asserts what it needs explicitly.
    await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  };
  const money = (n: number) => `AED ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  console.log("Billing journey");

  await step("sign up and set up the garage", async () => {
    await go("/signup");
    await page.getByLabel("Your name").fill("Samir Owner");
    await page.getByLabel("Email").fill(ownerEmail);
    await page.getByLabel("Password").fill(password);
    await click("Create account");
    await see("Set up your garage");
    await page.getByLabel("Phone").fill("04 321 0000");
    await page.getByLabel("Address").fill("Street 12, Al Quoz Industrial 3");
    await page.getByLabel("TRN (Tax Registration Number)").fill("100123456700003");
    await page.getByLabel("Standard VAT rate (%)").fill("5");
    await page.getByLabel("Default labor rate per hour (AED)").fill("200");
    await click("Create my garage");
    await page.getByRole("heading", { name: "BS Garage" }).waitFor();
    await see("No invoice yet");
    await shot("01-dashboard-empty");
  });

  await step("empty states are explicit, not blank", async () => {
    for (const [path, text] of [
      ["/invoices", "No invoice yet"],
      ["/customers", "No customer yet"],
      ["/parts", "No part in the catalog yet"],
      ["/estimates", "No estimate yet"],
      ["/job-cards", "No job card yet"],
      ["/outstanding", "Nothing outstanding"],
    ]) {
      await go(path);
      await see(text);
    }
  });

  await step("add a mechanic", async () => {
    await go("/settings?tab=mechanics");
    await page.getByLabel("Mechanic name").fill("Ravi Kumar");
    await click("Add mechanic");
    await see("Ravi Kumar");
  });

  await step("add a supplier", async () => {
    await go("/suppliers");
    await click("New supplier");
    await page.getByLabel("Company").fill("Al Quoz Auto Parts LLC");
    await page.getByLabel("Phone").fill("04 555 1234");
    await click("Save");
    await page.getByRole("heading", { name: "Al Quoz Auto Parts LLC" }).waitFor();
  });

  await step("add a part with opening stock", async () => {
    await go("/parts");
    await click("New part");
    await page.getByLabel("SKU").fill("BP-001");
    await page.getByLabel("Name").fill("Front brake pads");
    await page.getByLabel("Part number").fill("04465-60320");
    await page.getByLabel("Brand").fill("Toyota");
    await page.getByLabel("Purchase price (AED)").fill("80");
    await page.getByLabel("Selling price (AED)").fill("120");
    await see("Margin AED 40.00 (33.3%)");
    await page.getByLabel("Minimum stock").fill("4");
    await page.getByLabel("Main supplier").selectOption({ label: "Al Quoz Auto Parts LLC" });
    await page.getByLabel("Opening stock").fill("10");
    await click("Add part");
    await page.getByRole("heading", { name: "Front brake pads" }).waitFor();
    await see("10 pcs");
  });

  await step("add a service to the price list", async () => {
    await go("/services");
    await click("New service");
    await page.getByLabel("Name").fill("Oil Change");
    await page.getByLabel("Category").fill("Maintenance");
    await page.getByLabel("Price (AED, excl. VAT)").fill("150");
    await click("Save");
    await see("Oil Change");
  });

  await step("create a customer with two vehicles", async () => {
    await go("/customers");
    await click("New customer");
    await page.getByLabel("First name").fill("Ahmed");
    await page.getByLabel("Last name").fill("Al Mansoori");
    await page.getByLabel("Phone").fill("050 123 4567");
    await page.getByLabel("Email").fill("ahmed@example.com");
    await click("Create customer");
    await page.getByRole("heading", { name: "Ahmed Al Mansoori" }).waitFor();
    for (const v of [
      { code: "A", num: "12345", make: "Toyota", model: "Land Cruiser", year: "2021" },
      { code: "B", num: "777", make: "Nissan", model: "Patrol", year: "2019" },
    ]) {
      await page.getByRole("button", { name: "Add vehicle" }).first().click();
      await page.getByLabel("Code").fill(v.code);
      await page.getByLabel("Number", { exact: true }).fill(v.num);
      await page.getByLabel("Make").fill(v.make);
      await page.getByLabel("Model").fill(v.model);
      await page.getByLabel("Year").fill(v.year);
      await page.getByLabel("Mileage (km)").fill(v.num === "12345" ? "45000" : "88000");
      await page.getByRole("dialog").getByRole("button", { name: "Add vehicle" }).click();
      await see(`Dubai ${v.code} ${v.num}`);
    }
  });

  await step("duplicate plate is flagged before saving", async () => {
    await page.getByRole("button", { name: "Add vehicle" }).first().click();
    await page.getByLabel("Code").fill("A");
    await page.getByLabel("Number", { exact: true }).fill("12345");
    await page.getByLabel("Make").click();
    await see(/already registered/);
    await click("Cancel");
  });

  let total = 0;
  let invoiceUrl = "";
  let jobUrl = "";
  await step("estimate: find customer by phone, add part by SKU, labor, service; VAT computed", async () => {
    await go("/estimates/new");
    await page.getByLabel("Search customer").fill("0501234567");
    await page.getByRole("button", { name: /Dubai A 12345/ }).first().click();
    await see("Ahmed Al Mansoori");
    const catalog = page.getByLabel("Add a part or service");
    await catalog.fill("BP-001");
    await page.getByRole("option", { name: /Front brake pads/ }).waitFor();
    await catalog.press("Enter");
    await page.getByLabel("Qty").first().fill("4");
    await click(/^Labor$/);
    await page.getByLabel("Hours").fill("1.5");
    await catalog.fill("Oil");
    await page.getByRole("option", { name: /Oil Change/ }).click();
    await page.getByLabel("Mileage (km)").fill("45200");
    await page.getByLabel("Work requested").fill("Brake noise at the front, oil service due");
    // 4 × 120 + 1.5 × 200 + 150 = 930, VAT 5% = 46.50
    total = 976.5;
    await see(money(930));
    await see(money(46.5));
    await see(money(total));
    await shot("02-estimate-editor");
    await click("Save");
    await page.getByRole("heading", { name: /Estimate EST-00001/ }).waitFor();
  });

  await step("deposit on the estimate, before the repair", async () => {
    await click("Record deposit");
    await page.getByLabel("Amount (AED)").fill("300");
    await page.getByRole("radio", { name: "Cash" }).click();
    await click("Record payment");
    await see("Receipt RCT-00001");
    await click("Done");
    await see("Remaining after deposit:");
  });

  await step("send the estimate by WhatsApp (logged, marked sent)", async () => {
    await page.getByRole("button", { name: "WhatsApp" }).first().click();
    await page.waitForTimeout(800);
    await page.reload();
    await see("Sent on");
  });

  await step("approve and convert to a job card in one step", async () => {
    await click("Approve & create job card");
    await page.getByRole("dialog").getByLabel("Mechanic").selectOption({ label: "Ravi Kumar" });
    await page.getByRole("dialog").getByRole("button", { name: "Create job card" }).click();
    await page.getByRole("heading", { name: /Job card JC-00001/ }).waitFor();
    jobUrl = new URL(page.url()).pathname;
    await see("Front brake pads");
    await see("Brake noise at the front");
  });

  await step("repair: progress in the workshop", async () => {
    await click("In progress");
    await page.getByRole("button", { name: "In progress", exact: true }).and(page.locator("[aria-current=step]")).waitFor();
    await click("Update");
    await page.getByLabel("Diagnosis").fill("Front pads worn to 2 mm");
    await page.getByLabel("Work done").fill("Replaced front pads, oil and filter change");
    await click("Save");
    await see("Front pads worn to 2 mm");
    await page.getByRole("button", { name: "Ready", exact: true }).click();
    await page.getByRole("button", { name: "Ready", exact: true }).and(page.locator("[aria-current=step]")).waitFor();
    await shot("03-job-card");
  });

  await step("job card → invoice: deposit applied automatically", async () => {
    await click("Create invoice");
    await page.getByRole("heading", { name: "Draft invoice" }).waitFor();
    await see(/A deposit is attached/);
  });

  await step("issue the invoice: number, tax invoice, balance after deposit", async () => {
    await click("Issue invoice");
    await page.getByRole("heading", { name: "INV-00001" }).waitFor();
    await see("TAX INVOICE");
    await see("TRN 100123456700003");
    await see(money(total - 300));
    invoiceUrl = new URL(page.url()).pathname;
    await shot("04-invoice-issued");
  });

  await step("partial payment by card, receipt, remaining balance", async () => {
    await click("Record payment");
    await page.getByLabel("Amount (AED)").fill("400");
    await page.getByRole("radio", { name: "Card" }).click();
    await page.getByLabel("Reference").fill("AUTH 551122");
    await click("Record payment");
    await see("Receipt RCT-00002");
    await see(`Remaining balance: ${money(total - 700)}`);
    await shot("05-payment-recorded");
    await click("Done");
    await see("Partially paid");
  });

  await step("overpayment is refused", async () => {
    await click("Record payment");
    await page.getByLabel("Amount (AED)").fill("99999");
    await page.getByRole("radio", { name: "Cash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Record payment" }).click();
    await see(/The amount is more than/);
    await click("Cancel");
  });

  await step("pay the rest: invoice paid", async () => {
    await click("Record payment");
    await page.getByRole("dialog").getByRole("button", { name: "Full" }).click();
    await page.getByRole("radio", { name: "Cash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Record payment" }).click();
    await see("Receipt RCT-00003");
    await click("Done");
    await page.getByText("Paid", { exact: true }).first().waitFor();
  });

  await step("receipt prints with remaining balance", async () => {
    await go("/payments");
    await page.getByRole("link", { name: "RCT-00002" }).click();
    await see("PAYMENT RECEIPT");
    await see("AUTH 551122");
    await shot("06-receipt");
  });

  await step("stock went down by 4 when the invoice was issued", async () => {
    await go("/stock");
    await page.getByRole("row", { name: /Front brake pads/ }).getByText("6", { exact: true }).waitFor();
  });

  await step("vehicle history shows the job", async () => {
    await go("/vehicles");
    await page.getByRole("link", { name: "Dubai A 12345" }).click();
    await see("Service history");
    await see("INV-00001");
    await see("Front brake pads");
    await shot("07-vehicle-history");
  });

  await step("credit note for one returned pad, back to stock, refund due, refund", async () => {
    await go("/invoices");
    await page.getByRole("link", { name: "INV-00001" }).click();
    await page.getByRole("button", { name: "Credit note" }).click();
    await page.getByRole("dialog").getByLabel("Quantity to credit").first().fill("1");
    await page.getByLabel("Reason").fill("One pad returned unused");
    await click("Create credit note");
    await page.getByRole("heading", { name: /Credit note CN-00001/ }).waitFor();
    await see("TAX CREDIT NOTE");
    await page.getByRole("link", { name: /Invoice INV-00001/ }).click();
    await see("The customer is owed money.");
    await click("Record refund");
    await page.getByRole("radio", { name: "Cash" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Record refund" }).click();
    await see("Refund recorded");
    await click("Done");
    await page.getByText("Paid", { exact: true }).first().waitFor();
    await go("/stock");
    await page.getByRole("row", { name: /Front brake pads/ }).getByText("7", { exact: true }).waitFor();
  });

  await step("fast New Invoice: plate search, service, issue unpaid", async () => {
    await go("/invoices/new");
    await page.getByLabel("Search customer").fill("Dubai B 777");
    await page.getByRole("button", { name: /Dubai B 777/ }).first().click();
    await page.getByLabel("Add a part or service").fill("Oil");
    await page.getByRole("option", { name: /Oil Change/ }).click();
    await see(money(157.5));
    await click("Issue invoice");
    await page.getByRole("heading", { name: "INV-00002" }).waitFor();
    await see("Unpaid");
  });

  await step("outstanding invoices list it, with a WhatsApp reminder", async () => {
    await go("/outstanding");
    await see("INV-00002");
    await see(money(157.5));
    await page.getByRole("row", { name: /INV-00002/ }).getByRole("button", { name: "WhatsApp" }).click();
    await page.waitForTimeout(800);
    await page.reload();
    await see(/Last sent/);
    await shot("08-outstanding");
  });

  await step("cancel an unpaid invoice: keeps its number, cannot be paid", async () => {
    await go("/invoices/new");
    await page.getByLabel("Search customer").fill("Ahmed");
    await page.getByRole("button", { name: /Ahmed Al Mansoori/ }).first().click();
    await page.getByLabel("Add a part or service").fill("BP-001");
    await page.getByRole("option", { name: /Front brake pads/ }).click();
    await click("Issue invoice");
    await page.getByRole("heading", { name: "INV-00003" }).waitFor();
    await click("Cancel invoice");
    await page.getByLabel("Reason").fill("Customer changed their mind");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel invoice" }).click();
    await see(/CANCELLED|Cancelled/);
    await page.getByRole("button", { name: "Record payment" }).waitFor({ state: "detached" });
  });

  await step("customer profile: two vehicles, several invoices, total spent", async () => {
    await go("/customers");
    await page.getByRole("link", { name: "Ahmed Al Mansoori" }).click();
    await see("Total spent");
    await see("Outstanding balance");
    await page.getByRole("tab", { name: /Invoices/ }).click();
    await see("INV-00001");
    await see("INV-00002");
    await shot("09-customer-profile");
  });

  await step("global search: phone, plate, SKU", async () => {
    await page.keyboard.press("Control+k");
    const box = page.getByRole("dialog").getByLabel("Search");
    await box.fill("0501234567");
    await page.getByRole("dialog").getByText("Ahmed Al Mansoori").first().waitFor();
    await page.getByRole("dialog").getByText("INV-00001").first().waitFor();
    await box.fill("Dubai A 12345");
    await page.getByRole("dialog").getByText("Land Cruiser", { exact: false }).first().waitFor();
    await box.fill("BP-001");
    await page.getByRole("dialog").getByText(/Front brake pads/).first().waitFor();
    await page.getByRole("dialog").getByText("Al Quoz Auto Parts LLC").first().waitFor();
    await shot("10-search");
    await page.keyboard.press("Escape");
  });

  await step("dashboard shows today's revenue, outstanding, recent invoices", async () => {
    await go("/");
    await see("Today's revenue");
    await see("INV-00002");
    await see(/1 unpaid/);
    await shot("11-dashboard");
  });

  await step("reports: totals, per mechanic, CSV export", async () => {
    await go("/reports?period=today");
    await see("Revenue per mechanic");
    await see("Ravi Kumar");
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const file = await dl;
    if (!file.suggestedFilename().endsWith(".csv")) throw new Error("no CSV");
    await shot("12-reports");
  });


  console.log("Workshop, stock and purchasing");

  await step("inspection from the job card: tyres urgent, report", async () => {
    await go(jobUrl);
    await click("Start inspection");
    await page.getByRole("heading", { name: /Inspection — Dubai A 12345/ }).waitFor();
    await page.getByRole("radiogroup", { name: "Tires" }).getByRole("radio", { name: "Urgent" }).click();
    await page.getByLabel("Comment on Tires").fill("Front tread 2 mm");
    await page.getByLabel("Comment on Tires").blur();
    for (const item of ["Brakes", "Battery", "Oil", "Lights"]) {
      await page.getByRole("radiogroup", { name: item }).getByRole("radio", { name: "OK" }).click();
    }
    await page.getByLabel("Recommendations").fill("Replace front tyres within 2 weeks");
    await click("Complete inspection");
    await see("Inspection completed.");
    await see("1 urgent");
    await go(`/print/inspection/${new URL(page.url()).pathname.split("/").pop()}`);
    await see("INSPECTION REPORT");
    await see("Front tread 2 mm");
    await shot("13-inspection-report");
  });

  await step("appointment booked for tomorrow appears in the week", async () => {
    await go("/appointments?view=week");
    await click("New appointment");
    await page.getByRole("dialog").getByLabel("Search customer").fill("Ahmed");
    await page.getByRole("dialog").getByRole("button", { name: /Ahmed Al Mansoori/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: /Dubai B 777/ }).click();
    await page.getByLabel("Reason").fill("AC not cooling");
    const tomorrow = new Date(Date.now() + 86_400_000 + 4 * 3_600_000).toISOString().slice(0, 10);
    await page.getByLabel("Date").fill(tomorrow);
    await page.getByLabel("Time").fill("10:30");
    await click("Save");
    await page.locator("dialog[open]").waitFor({ state: "detached" }).catch(() => {});
    await go(`/appointments?view=week&date=${tomorrow}`);
    await see("AC not cooling");
    await go(`/appointments?view=month&date=${tomorrow}`);
    await shot("14-appointments-month");
  });

  await step("purchase order: order, receive, stock and cost update", async () => {
    await go("/purchase-orders/new");
    await page.getByLabel(/^Supplier\b/).first().selectOption({ label: "Al Quoz Auto Parts LLC" });
    await page.getByLabel("Add a part or service").fill("BP-001");
    await page.getByRole("option", { name: /Front brake pads/ }).click();
    await page.getByLabel("Qty").fill("5");
    await page.getByLabel("Unit cost").fill("75");
    await click("Save purchase order");
    await page.getByRole("heading", { name: "PO-00001" }).waitFor();
    await click("Mark as ordered");
    await see("Ordered");
    await click("Receive goods");
    await page.getByRole("dialog").getByRole("button", { name: "All" }).click();
    await click("Add to stock");
    await see("Goods received and added to stock.");
    await go("/stock");
    await page.getByRole("row", { name: /Front brake pads/ }).getByText("12", { exact: true }).waitFor();
    await go("/parts");
    await page.getByRole("link", { name: "Front brake pads" }).click();
    await see("Received from supplier");
    await see("AED 75.00");
  });

  await step("discount: 10% on a draft invoice, VAT on the discounted amount", async () => {
    await go("/invoices/new");
    await page.getByLabel("Search customer").fill("Ahmed");
    await page.getByRole("button", { name: /Ahmed Al Mansoori/ }).first().click();
    await page.getByLabel("Add a part or service").fill("Oil");
    await page.getByRole("option", { name: /Oil Change/ }).click();
    await page.getByLabel("Discount", { exact: true }).selectOption("percent");
    await page.getByLabel("%", { exact: true }).fill("10");
    // 150 − 15 = 135, VAT 6.75, total 141.75
    await see(`−${money(15)}`);
    await see(money(6.75));
    await see(money(141.75));
    await click("Save as draft");
    await page.getByRole("heading", { name: "Draft invoice" }).waitFor();
    await see(money(141.75));
    await click("Delete draft");
    await page.getByRole("dialog").getByRole("button", { name: "Delete draft" }).click();
    await page.getByRole("heading", { name: "Invoices" }).waitFor();
  });

  await step("an error while loading is shown as an error, never as an empty list", async () => {
    await page.route(/\/rest\/v1\/v_invoices/, (r) => r.abort());
    await go("/invoices");
    await see("This could not be loaded.");
    const empty = await page.getByText("No invoice yet").count();
    if (empty) throw new Error("the failed read was shown as an empty list");
    await page.unroute(/\/rest\/v1\/v_invoices/);
    await click("Try again");
    await see("INV-00001");
  });

  await step("printable invoice page", async () => {
    await go(`/print/invoice/${invoiceUrl.split("/").pop()}`);
    await see("TAX INVOICE");
    await see("Print / Save PDF");
    await shot("15-print-invoice");
  });

  console.log("Roles and permissions");

  await step("owner invites a mechanic by email", async () => {
    await go("/settings?tab=team");
    await page.getByLabel("Email").fill(mechEmail);
    await page.getByLabel("Name").fill("Ravi Kumar");
    await page.getByLabel("Role", { exact: true }).selectOption("mechanic");
    await click("Invite");
    await see("Pending invitations");
  });

  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await mctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const m = await mctx.newPage();
  m.on("pageerror", (e) => pageErrors.push(`mechanic: ${e.message}`));

  await step("the mechanic signs up and joins the garage with the mechanic role", async () => {
    await m.goto(base + "/signup");
    await m.getByLabel("Your name").fill("Ravi Kumar");
    await m.getByLabel("Email").fill(mechEmail);
    await m.getByLabel("Password").fill(password);
    await m.getByRole("button", { name: "Create account" }).click();
    await m.getByRole("heading", { name: "BS Garage" }).waitFor();
    await m.getByText("Vehicles in workshop").first().waitFor();
    if (await m.getByText("Today's revenue").count()) throw new Error("a mechanic sees revenue");
  });

  await step("the mechanic cannot open invoices, payments, reports or settings", async () => {
    for (const path of ["/invoices", "/payments", "/reports", "/settings", "/outstanding"]) {
      await m.goto(base + path);
      await m.getByText("Your role does not give access to this page.").first().waitFor();
    }
    await m.goto(base + invoiceUrl);
    await m.getByText("Your role does not give access to this page.").first().waitFor();
  });

  await step("owner links the mechanic account to Ravi", async () => {
    await go("/settings?tab=mechanics");
    await page.getByLabel("User account of Ravi Kumar").selectOption({ label: "Ravi Kumar" });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  });

  await step("the mechanic sees their job card without prices and updates progress", async () => {
    await m.goto(base + "/job-cards?filter=all");
    await m.getByText("JC-00001").first().click();
    await m.getByRole("heading", { name: /Job card JC-00001/ }).waitFor();
    await m.getByText("Front brake pads").first().waitFor();
    if (await m.getByText("Estimated total").count()) throw new Error("prices shown to a mechanic");
    if (await m.getByRole("button", { name: "Create invoice" }).count()) throw new Error("mechanic can invoice");
    await m.getByRole("button", { name: "Delivered", exact: true }).click();
    await m.getByRole("button", { name: "Delivered", exact: true }).and(m.locator("[aria-current=step]")).waitFor();
    await m.screenshot({ path: `${out}/16-mechanic-job-card-phone.png`, fullPage: true });
  });
  await mctx.close();

  console.log("Arabic and right-to-left");

  await step("Arabic interface switches to right-to-left", async () => {
    await go("/");
    await page.getByRole("button", { name: "العربية" }).first().click();
    await page.getByRole("heading", { name: "BS Garage" }).waitFor();
    const dir = await page.evaluate(() => document.documentElement.dir);
    if (dir !== "rtl") throw new Error(`dir=${dir}`);
    await see("إيرادات اليوم");
    await see("فاتورة جديدة");
    await shot("17-dashboard-arabic");
    await go(invoiceUrl);
    await see("فاتورة ضريبية");
    await shot("18-invoice-arabic");
    await page.getByRole("button", { name: "English" }).first().click();
    await see("Today's revenue").catch(async () => {
      await go("/");
      await see("Today's revenue");
    });
  });

  console.log("Responsive: phone, tablet, laptop, desktop");

  const pages = [
    "/", "/invoices", "/invoices/new", invoiceUrl, "/outstanding", "/payments", "/estimates", "/estimates/new", "/job-cards", jobUrl,
    "/customers", "/vehicles", "/parts", "/services", "/stock", "/suppliers", "/purchase-orders", "/appointments", "/appointments?view=month",
    "/inspections", "/reports", "/audit", "/settings", "/settings?tab=import", `/print/invoice/${invoiceUrl.split("/").pop()}`,
  ];
  for (const width of [360, 768, 1024, 1440]) {
    await step(`no horizontal overflow at ${width}px on ${pages.length} screens`, async () => {
      await page.setViewportSize({ width, height: width < 800 ? 800 : 900 });
      const bad: string[] = [];
      for (const path of pages) {
        await go(path);
        await page.waitForTimeout(150);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (over > 1) bad.push(`${path} (+${over}px)`);
      }
      if (width === 360) {
        await go("/invoices/new");
        await shot("19-phone-new-invoice");
        await go(invoiceUrl);
        await shot("20-phone-invoice");
      }
      if (width === 768) {
        await go("/");
        await shot("21-tablet-dashboard");
        await go(jobUrl);
        await shot("22-tablet-job-card");
      }
      if (bad.length) throw new Error(`overflow: ${bad.join(", ")}`);
    });
  }
  await page.setViewportSize({ width: 1360, height: 900 });

  await step("audit log records who did what and when", async () => {
    await go("/audit");
    await see("Invoice issued");
    await see("Payment recorded");
    await see("Credit note created");
    await see("Invoice cancelled");
    await see("Part price changed");
    await shot("23-audit-log");
  });

  return finish();

  async function finish(): Promise<number> {
    await ctx.close();
    console.log(`\n${passed} steps passed, ${failures.length} failed.`);
    if (pageErrors.length) console.log("Page errors:", pageErrors.slice(0, 10));
    for (const f of failures) console.log(`  ✗ ${f}`);
    return failures.length || pageErrors.length ? 1 : 0;
  }
}
