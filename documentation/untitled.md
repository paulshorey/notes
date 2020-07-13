# GitBook

It's a brilliant platform for editing Markdown docs. It generates a beautiful website from your markdown files. You can edit the ".md" files manually or use their GUI. After you save, your beautiful documentation website is generated and published automatically.

## However,

to share your docs, you have to direct people to their website. You can use your own domain, but it is still their website. To replace their branding, it's a minimum of $300/mo. You can not embed the content on your own site. 

I figured out a work-around. This script downloads their entire website to your local filesystem. You can then serve the downloaded content using your own server, and embed it in an iframe.

`wget --mirror -p --html-extension --convert-links -r https://paulshorey.gitbook.io/nlp-studio/ docs.nlp.studio`

