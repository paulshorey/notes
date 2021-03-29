# Fix Google search results

### 1\) Stop seeing old 10+ year old results

Google Search lets you specify the date range of results. You can search only pages that have been written in the past year, month, days, few years, etc. However, you have to open up menus every time to do this. Google does not remember your preference. Too much clicking.

Here is how to set your default search timeframe:

1. Browser settings
2. Manage Search Engines
3. Add new search engine with this url: `{google:baseURL}search?tbs=qdr:y2&q=%s&{google:RLZ}{google:originalQueryForSuggestion}{google:assistedQueryStats}{google:searchFieldtrialParameter}{google:iOSSearchLanguage}{google:searchClient}{google:sourceId}{google:contextualSearchVersion}ie={inputEncoding}` The `qdr:y2` means to search in only the past 2 years. Google more about this to find the codes for month/day. For 1 year do `qdr:y1`.
4. Set it as default

Now, at least when searching from the browser address bar, the Google search will be limited to recent content by default. You can easyily change it anytime. The setting will now appear easy-access, just below the search input.

### 2\) Block certain domains from showing up in search results. 

These domains often take over the results, sometimes filling up half the page, but providing very little value:

```text
/wikihow\./
/geeksforgeeks\./
/codegrepper\./
/xspdf\./
/medium\./
/pinterest\./
/amazon\./
/facebook\./
```

Install browser extension `uBlock`. Then, change your google search results preferences to display 100 results at a time. Then, this extension will remove the specified domains from search results, keeping new relevant ones. You can click "block this site" next to each Google search result, to add that domain to your blacklist.



