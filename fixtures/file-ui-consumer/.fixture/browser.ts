import assert from 'node:assert/strict'
import { expect, type Browser } from '@playwright/test'

// Reviewed TanStack adaf33a8 assertions, mounted in the actual Nuxt production app.
export async function runBrowser(browser: Browser, baseUrl: string) {
		const page = await browser.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
		await page.goto(`${baseUrl}/browser`);
		await page.locator('[data-fixture-hydrated="true"]').waitFor();
		const ui = page.getByRole("region", { name: "Files", exact: true });
		const table = ui.getByRole("table", { name: "Files", exact: true });
		const status = ui.getByRole("status");
		const input = ui.getByLabel("Choose a file", { exact: true });
		const calls = page.getByLabel("Upload calls", { exact: true });
		const row = (name: string) => table.getByRole("row").filter({ has: page.getByRole("rowheader", { name, exact: true }) });
		const select = async (name: string, text = "file content", mimeType = "text/plain") => input.setInputFiles({ name, mimeType, buffer: Buffer.from(text) });
		const mode = (value: string) => page.getByLabel("Next upload", { exact: true }).selectOption(value);
		await expect(status).toHaveText("5 files loaded.");
		await expect(ui.getByRole("button", { name: "Upload file", exact: true })).toBeDisabled();
		await expect(table.getByRole("link", { name: "Download report.pdf", exact: true })).toHaveAttribute("download", "report.pdf");
		for (const name of ["pending.txt", "cleanup.txt", "removed.txt"]) await expect(row(name).getByRole("link")).toHaveCount(0);
		await expect(row("removed.txt").getByRole("button")).toHaveCount(0);
		const hostileName = '<img src=x onerror="window.previewExecuted=true">.html';
		await row(hostileName).getByText("Details", { exact: true }).press("Enter");
		await expect(row(hostileName).getByText("text/html", { exact: true })).toBeVisible();
		await expect(table.locator("img, iframe, object, embed, script")).toHaveCount(0);
		const downloadEvent = page.waitForEvent("download");
		await table.getByRole("link", { name: "Download report.pdf", exact: true }).click();
		assert.equal((await downloadEvent).suggestedFilename(), "fixture.txt");

		await input.setInputFiles({ name: "oversize.txt", mimeType: "text/plain", buffer: Buffer.alloc(1025) });
		await expect(ui.getByRole("alert")).toHaveText("Choose a file no larger than 1.0 KiB.");
		await expect(calls).toHaveText("0");
		await expect(input).toHaveValue("");
		await select("retry.txt");
		await mode("fail");
		await ui.getByRole("button", { name: "Upload file", exact: true }).press("Enter");
		await expect(ui.getByRole("alert")).toContainText("Upload could not be confirmed");
		await expect(ui.getByText("Selected: retry.txt (12 bytes)", { exact: true })).toBeVisible();
		await expect(input).not.toHaveValue("");
		await expect(ui).not.toContainText("private-provider-message");
		await expect(calls).toHaveText("1");
		await ui.getByRole("button", { name: "Retry upload", exact: true }).click();
		await expect(status).toHaveText("Uploaded retry.txt.");
		await expect(calls).toHaveText("2");
		await expect(input).toHaveValue("");
		await expect(row("retry.txt")).toHaveCount(1);

		await select("ambiguous.txt");
		await mode("committed-error");
		await ui.getByRole("button", { name: "Upload file", exact: true }).click();
		await expect(ui.getByRole("alert")).toContainText("could not be confirmed");
		await ui.getByRole("button", { name: "Retry upload", exact: true }).click();
		await expect(status).toHaveText("Uploaded ambiguous.txt.");
		await expect(row("ambiguous.txt")).toHaveCount(1);
		await expect(calls).toHaveText("4");

		await select("cancel.txt");
		await mode("wait");
		// Dispatch two synchronous submissions to cover the pre-render lock, too.
		await ui.locator("form").evaluate((form) => {
			form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
			form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		});
		await expect(calls).toHaveText("5");
		await expect(input).toBeDisabled();
		await expect(ui.getByRole("button", { name: "Refresh files", exact: true })).toBeDisabled();
		await ui.getByRole("button", { name: "Cancel upload", exact: true }).click();
		await expect(status).toContainText("Upload cancelled locally");
		await expect(status).toContainText("server may still have received it");
		await ui.getByRole("button", { name: "Retry upload", exact: true }).click();
		await expect(status).toHaveText("Uploaded cancel.txt.");
		await expect(calls).toHaveText("6");

		await select("pending-replay.txt");
		await mode("pending");
		await ui.getByRole("button", { name: "Upload file", exact: true }).click();
		await expect(status).toContainText("awaiting confirmation");
		await expect(row("pending-replay.txt").getByRole("link")).toHaveCount(0);
		await ui.getByRole("button", { name: "Retry upload", exact: true }).click();
		await expect(status).toHaveText("Uploaded pending-replay.txt.");
		await expect(calls).toHaveText("8");

		await select("cancel-race.txt");
		await mode("cancel-race");
		await ui.getByRole("button", { name: "Upload file", exact: true }).click();
		await expect(calls).toHaveText("9");
		await ui.getByRole("button", { name: "Cancel upload", exact: true }).click();
		await expect(status).toContainText("Cancellation requested");
		await expect(ui.getByRole("button", { name: "Upload file", exact: true })).toBeDisabled();
		await page.getByRole("button", { name: "Finish pending upload", exact: true }).click();
		await expect(status).toContainText("server confirmed the upload completed despite local cancellation");
		await expect(row("cancel-race.txt").getByRole("link")).toHaveCount(1);

		await page.getByRole("button", { name: "Fail next refresh", exact: true }).click();
		await ui.getByRole("button", { name: "Refresh files", exact: true }).click();
		await expect(ui.getByRole("alert")).toContainText("displayed list may be out of date");
		await expect(row("report.pdf")).toHaveCount(1);
		await ui.getByRole("button", { name: "Refresh files", exact: true }).click();
		await expect(ui.getByRole("alert")).toHaveCount(0);
		for (const name of ["retry.txt", "ambiguous.txt", "cancel.txt", "pending-replay.txt"]) await expect(row(name)).toHaveCount(1);
		await page.getByRole("button", { name: "Delay next refresh", exact: true }).click();
		await ui.getByRole("button", { name: "Refresh files", exact: true }).click();
		await select("new-during-refresh.txt");
		await ui.getByRole("button", { name: "Upload file", exact: true }).click();
		await expect(status).toHaveText("Uploaded new-during-refresh.txt.");
		await page.getByRole("button", { name: "Finish delayed refresh", exact: true }).click();
		await expect(row("new-during-refresh.txt")).toHaveCount(1);
		await expect(status).toHaveText("Uploaded new-during-refresh.txt.");

		await page.getByRole("button", { name: "Fail next removal", exact: true }).click();
		await row("report.pdf").getByRole("button", { name: "Remove report.pdf", exact: true }).click();
		await expect(ui.getByRole("alert")).toContainText("Removal could not be confirmed");
		await ui.getByRole("button", { name: "Refresh files", exact: true }).click();
		await expect(ui.getByRole("alert")).toHaveCount(0);
		await row("report.pdf").getByRole("button", { name: "Remove report.pdf", exact: true }).click();
		await expect(status).toContainText("pending storage cleanup");
		await expect(row("report.pdf").getByRole("link")).toHaveCount(0);
		await row("report.pdf").getByRole("button", { name: "Retry removal of report.pdf", exact: true }).click();
		await expect(status).toHaveText("Removed report.pdf.");
		await expect(row("report.pdf").getByRole("button")).toHaveCount(0);
		await expect(page.getByLabel("Retry mismatches", { exact: true })).toHaveText("0");

		await select("old-scope.txt");
		await mode("ready");
		await mode("cancel-race");
		await ui.getByRole("button", { name: "Upload file", exact: true }).click();
		await expect(calls).toHaveText("11");
		await page.getByRole("button", { name: "Switch client scope", exact: true }).click();
		await expect(status).toHaveText("1 file loaded.");
		await expect(table.locator("tbody tr")).toHaveCount(1);
		await expect(row("other-scope.txt")).toHaveCount(1);
		await page.getByRole("button", { name: "Finish original scope upload", exact: true }).click();
		await expect(row("old-scope.txt")).toHaveCount(0);
		await expect(row("report.pdf")).toHaveCount(0);
		await expect(input).toHaveValue("");
		await page.getByRole("button", { name: "Toggle file UI", exact: true }).click();
		await expect(ui).toHaveCount(0);
		await page.getByRole("button", { name: "Toggle file UI", exact: true }).click();
		await expect(status).toHaveText("1 file loaded.");
		assert.deepEqual(errors, []);
		await page.close();
		console.info("File UI: actual SSR/hydration, metadata-only preview, attachment download, size bounds, retry identity, ambiguous outcomes, cancellation race, synchronous double-submit, stale-list rejection, removal cleanup and scope/unmount isolation passed");
}
