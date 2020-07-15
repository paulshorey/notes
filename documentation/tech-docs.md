# Website builders for technical documentation or knowledgebase

## [Readme.com](https://Readme.com)

If you can afford $400/month, then definitely use this. It can handle regular documentation, and API reference, including versions. For the $400/mo, you can even include custom CSS/HTML/JS!

However... To use this,  you need to write your OpenAPI documentation 100% correctly \(dot the i's, cross the t's\), by specifying schemas for all parameters and responses. If you yaml file is not perfect, it will not be accepted.

Use this validator, to debug your file:  
[https://apitools.dev/swagger-parser/online/](https://apitools.dev/swagger-parser/online/)

## [Slate for NodeJS](https://github.com/jmanek/slate_node)

It can document API quite well!  But it's great for documenting any kind of code - with English description in the middle column, and code examples in the right column.

This version of slate is run by NodeJS, with fewer dependencies, so it's easier to set up. The end result looks the same.

The major difference is the use of [marked](https://github.com/chjj/marked) for parsing the .md, [highlight](https://highlightjs.org/) for syntax highlighting, and [Handlebars](http://handlebarsjs.com/) for templating.

Example: [http://jmanek.github.io/slate\_node/](http://jmanek.github.io/slate_node/)

## [MkDocs](https://squidfunk.github.io/mkdocs-material/), [Docusaurus](https://docusaurus.io)

Install and host it yourself. No API reference docs, but otherwise great content and UI.

MkDocs example: [https://fastapi.tiangolo.com/](https://fastapi.tiangolo.com/)  
Docusaurus example: [https://docusaurus.io/docs/en/installation](https://docusaurus.io/docs/en/installation)

## [GitBook](https://gitbook.com)

It's a brilliant platform for editing Markdown docs. It generates a beautiful website from your markdown files. You can edit the ".md" files manually or use their GUI. After you save, your beautiful documentation website is generated and published automatically to your domain. It looks the best. 

Example: This site. Also visit [nlp.studio](https://nlp.studio)

## [Atlassian Confluence](https://www.atlassian.com/software/confluence)

It is the most advanced collaboration software for large teams. Multiple people can be editing the same file without merge conflicts. It has very powerful permissions settings.

But... Their UI is so cumbersome to use and difficult to navigate. Especially for a large and/or disorganized team, Confluence docs turn out to be a big mess, because everyone struggles with all their bloated unwieldy UI. People use it because they have to, and use it as little as possible, to get it over with. All this leads to confusing and incomplete documentation.

