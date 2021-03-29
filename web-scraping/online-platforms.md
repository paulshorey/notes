# Online Platforms

\*\*\*\*[**Luminati.io**](https://Luminati.io) **- is the best proxy / static web scraper**

It's not good to crawl by xPath, because it usually looks like this:  
`//*[@id="content"]/div[3]/div/div[1]/div/div[2]/div/div[1]/div/a[6]`

\*\*\*\*[**APIFY**](https://apify.com) **is a great service to schedule crawls**, without running your own server. It lets you write Puppeteer code, use a proxy, and handle errors.

Indeed jobs is a great thing to scrape. Lots of content. No captcha. Use this as the "start url" in APIFY:  
[https://www.indeed.com/jobs?q=Javascript+Node+-junior+-jr+-intern+-graduate+-associate+-qa+-java&fromage=14&start=0](https://www.indeed.com/jobs?q=Javascript+Node+-junior+-jr+-intern+-graduate+-associate+-qa+-java&fromage=14&start=320)

Browser masking: Use Chrome, Use Stealth mode  
Security: Ignore SSL errors, Ignore CORS and CSP

## Notes

**Pre-programmed phantom scrapers SAAS:** [**https://phantombuster.com**](https://phantombuster.com/pricing)   
****\(not as easy to customize as APIFY, their pre-programmed solutions for LinkedIn Jobs was not automated enough, too slow, crawled too few jobs at a time\)  
**However,** they have automated a great way to download all the jobs links from an Indeed search, called **LinkedIn Search Export**

