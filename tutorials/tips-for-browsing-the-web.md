---
description: WORK IN PROGRESS _ ARTICLE NOT FINISHED
---

# Tips for searching the web

### Google Search results

have been having a hard time keeping up with all the nonsense out there. It's amazing what Google/Bing are able to do. Google has many more "advanced search" features, letting you search inside a certain site or date range or file type, or use advanced operators like quotes or minus sign to exclude a word. So, Google is better... except that it very often gives very outdated 10+ year old results! Especially when I'm searching for technology and cultural topics, that is beyond outdated. What to do?

Google Search lets you specify the date range of results. You can search only pages that have been written in the past year, month, days, few years, etc. However, you have to do this each time. It does not remember your preference. Too much clicking. There is a trick to make it remember.

Here is a trick to fix that...

1. Browser settings
2. Manage Search Engines
3. Add new search engine with this url: `{google:baseURL}search?tbs=qdr:y2&q=%s&{google:RLZ}{google:originalQueryForSuggestion}{google:assistedQueryStats}{google:searchFieldtrialParameter}{google:iOSSearchLanguage}{google:searchClient}{google:sourceId}{google:contextualSearchVersion}ie={inputEncoding}` The `qdr:y2` means to search in only the past 2 years. Google more about this to find the codes for month/day. For 1 year do `qdr:y1`.
4. Set it as default

Now, at least when searching from the browser address bar, the Google search will be limited to recent content - by default - you can change it - the setting will be just below the search input.





