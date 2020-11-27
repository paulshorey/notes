# Web crawling / Data mining

\*\*\*\*[**Luminati.io**](https://Luminati.io) **- is the best proxy / static web scraper**  
[**APIFY.com**](https://APIFY.com) **- great SaaS tool to crawl JS pages \(using Puppeteer\)**

Select DOM element by xPath:`let el = document.evaluate('xPathValue', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`

However, it's not good to crawl by xPath, because it usually looks like this:  
`//*[@id="content"]/div[3]/div/div[1]/div/div[2]/div/div[1]/div/a[6]` 

If the website HTML structure changes a bit, the crawler will break. Better to stick to good old CSS/jQuery selectors.













