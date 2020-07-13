# GitBook

It's a brilliant platform for editing Markdown docs. It generates a beautiful website from your markdown files. You can edit the ".md" files manually or use their GUI. After you save, your beautiful documentation website is generated and published automatically to your domain.

## Embed on your own website

Unfortunately, to share your documentation with the world, you have to direct people to the GitBook website. You can alias your own domain and upload a logo, but that's all. To remove their branding, it's a minimum of $300/mo, and even then you can not add CSS or Javascript.

I figured out a work-around. Here is a step by step tutorial, how I used GitBook-generated HTML pages, including links, CSS, and JavaScript, but put hosted it on my own server. I was able to manipulate the site, remove their branding, and inject my own HTML/CSS/JavaScript:



This script downloads their entire website to your local filesystem. You can then serve the downloaded content using your own server, and embed it in an iframe.

`wget --mirror -p --html-extension --convert-links -r https://paulshorey.gitbook.io/nlp-studio/ docs.nlp.studio`

