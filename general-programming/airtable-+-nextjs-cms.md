# Airtable + NextJS = CMS

copy your Airtable API Key...  
[https://airtable.com/account](https://airtable.com/account)

create a base, and a table called "home" or "about" or "product1"...  
[https://airtable.com/tblMe4OWbzTTNjJBZ/viw3npukvUHMY4fWu?blocks=hide](https://airtable.com/tblMe4OWbzTTNjJBZ/viw3npukvUHMY4fWu?blocks=hide)

npm i react airtable react-markdown  
[https://github.com/paulshorey/marina  
](https://github.com/paulshorey/marina)[http://localhost:3006/](http://localhost:3006/)

in Airtable, setup automation: when record is updated, send email to some unique email address or your email with a unique folder for deployments

use Integromat to monitor that same email address or folder every few minutes. When inbox/folder has new unopened emails, close them, and trigger a HTTP request  
[https://www.integromat.com/org/738097\#tab:scenarios](https://www.integromat.com/org/738097#tab:scenarios)

in Vercel \(NextJS build CI\), go to project settings -&gt; GIT -&gt; deploy hooks, and set up a URL to trigger a new build  
[https://vercel.com/paulshorey/marina/8NpzJ8w38AiVcsNwkee4ZvPBmivR](https://vercel.com/paulshorey/marina/8NpzJ8w38AiVcsNwkee4ZvPBmivR)

Tada! The website is now built whenever the Airtable data updates. For **free**, this check happens every 15 minutes, with another 1 or 2 to build. Upgrade Integromat to check every 5 or 1 minute. Would be nice if Airtable could trigger the HTTP request directly. Hope they add this soon.

