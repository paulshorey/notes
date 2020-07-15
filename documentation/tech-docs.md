# Website builders for technical documentation or knowledgebase

## [Readme.com](https://Readme.com)

If you can afford $400/month, then definitely try this. The lower tiers are disappointing, and are trying hard to up-sell the pricy "Business" plan.

Handles regular docs and API reference beautifully! But, if your OpenAPI yaml file has even the slightest error, it will refuse to upload it. This is very unfortunate, because I'm not yet an expert with OpenAPI spec, and most developers are not. Other documentation services are forgiving of missing properties and little things like that. To use this one,  you need to be perfect.

## [MkDocs](https://squidfunk.github.io/mkdocs-material/), [Docusaurus](https://docusaurus.io)

Install and host it yourself. No API reference docs, but otherwise great content and UI.

MkDocs example: [https://fastapi.tiangolo.com/](https://fastapi.tiangolo.com/)  
Docusaurus example: [https://docusaurus.io/docs/en/installation](https://docusaurus.io/docs/en/installation)

## [Slate for NodeJS](https://github.com/jmanek/slate_node)

Like MkDocs and Docusaurus, but better! It can document API quite well!

This version of slate is run by NodeJS, with fewer dependencies, so it's easier to set up. The end result looks the same.

The major difference is the use of [marked](https://github.com/chjj/marked) for parsing the .md, [highlight](https://highlightjs.org/) for syntax highlighting, and [Handlebars](http://handlebarsjs.com/) for templating.

Example: [http://jmanek.github.io/slate\_node/](http://jmanek.github.io/slate_node/)

## [GitBook](https://gitbook.com)

It's a brilliant platform for editing Markdown docs. It generates a beautiful website from your markdown files. You can edit the ".md" files manually or use their GUI. After you save, your beautiful documentation website is generated and published automatically to your domain. It looks the best. 

Example: This site. Also visit [nlp.studio](https://nlp.studio)

## [Atlassian Confluence](https://www.atlassian.com/software/confluence)

It is the most advanced collaboration software for large teams. Multiple people can be editing the same file without merge conflicts. It has very powerful permissions settings.

But... Their UI is so cumbersome to use and difficult to navigate. Especially for a large and/or disorganized team, Confluence docs turn out to be a big mess, because everyone struggles with all their bloated unwieldy UI. People use it because they have to, and use it as little as possible, to get it over with. All this leads to confusing and incomplete documentation.

