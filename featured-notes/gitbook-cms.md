# GitBook as a headless CMS

GitBook is a brilliant GUI which generates a folder of Markdown files. It also generates a beautiful website from your Markdown files, and publishes to a domain of your choice.

Unfortunately, your documentation will have to be on a separate domain \(like most services and projects, to be fair\). If you care about SEO \(being found in Google results\), your content will have to be on the same domain as the rest of your site. Also, to remove their branding it's a minimum of $300/mo, and even then you can not add CSS or Javascript. So, the site GitBook generates is very pretty, very easy, but not much use to an online business strategy except to provide documentation.

### I want more. Luckily, I am a programmer...

GitBook has a really great feature - the reason I use it at all... It stores all my content in my own Github repository, as markdown notes. Imagine that, you get to own and control your own content! Sure, self-hosted open-source documentation frameworks store content locally, but they don't provide a really nice GUI editor app, to edit the content. You have to fumble with their open-source simple editor, or edit the markdown yourself. With Gitbook, you can edit your own markdown, but also use their hosted editor, from any computer, on their website. The content gets deposited to your Github repo. They even generate a very nice navigation menu, also in markdown. This feature I have not seen in even the best open-source tools. You have to do it manually. Also, their GUI does a great job helping you manage internal links and media files.

#### 1. Connect Gitbook + Github

Setup your accounts, write some content. In app.gitbook.com, click "Integrations" and "Github".

#### 2. On your website/server, always pull down the latest content

On the Github repo you just integrated, set up a "webhook" to your server. Then, whenever the content changes, you can always pull down the latest content.

#### 3. Convert that downloaded Markdown to HTML

Your script can be in any language. I use Node.js/Bash, and will publish my code to do all these steps, after I'm sure it works flawlessly. Currently deciding on 2 ways to do it.

**3.A\)** Convert to HTML first, then include into website \(using markdown-folder-to-html, my own forked version\). With a framework like React, I would use the "html-loader" Webpack plugin.

**3.B\)** Include the Markdown into website and convert to HTML - all during the compile/build process. This is great for a React or similar app. There is a webpack plugin "markdown-loader" which is like the "html-loader", but handles Markdown using the "marked" npm project.

#### 4. Use the HTML in your website

The Markdown files from Gitbook, and the converted HTML files, will include SUMMARY .md/.html. Use it as a navigation menu. All links are relative.

What happens when somebody clicks on a link? 

You'll have to include and show the correct documentation page. With an old fashioned simple HTML site, it's simple. All nav links are relative, so just let them point to the HTML file. 

With a fancy new Webpack/React app, however, it's more complicated. You'll have to figure out dynamic routing - probably by converting that SUMMARY.md file to a React component which uses &lt;Link to="" /&gt; elements. When someone clicks a link, it goes to that route. Then React will dynamically include the corresponding file. Guess this is why nobody did this yet. It's a hassle, but doable.

If you want a great CMS user-interface to edit content, and a great documentation section inside your main app \(not on a separate domain\), then this may be worth it. 

