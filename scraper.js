const puppeteer = require("puppeteer");

(async () => {
  // 1. Launch browser
  const browser = await puppeteer.launch({ headless: false }); // headless: false shows the browser
  const page = await browser.newPage();

  // 2. Go to login page
  await page.goto("https://example.com/login"); // replace this with your actual URL

  // 3. Type username and password
  await page.type("#username", "yourUsername"); // use real input IDs or names
  await page.type("#password", "yourPassword");

  // 4. Click login button
  await page.click("button[type='submit']");

  // 5. Wait for the next page to load
  await page.waitForNavigation();

  // 6. Navigate to the protected page
  await page.goto("https://example.com/dashboard");

  // 7. Extract some data
  const secretData = await page.$eval(".secret-info", el => el.textContent);
  console.log("Protected Info:", secretData);

  // 8. Close browser
  await browser.close();
})();
