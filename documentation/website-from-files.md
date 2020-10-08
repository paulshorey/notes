# Website from Files

## [Slate Docs](https://github.com/slatedocs/slate) \(and the [Node.js version](https://github.com/sdelements/node-slate)\)

This is the best open-source tool for a 2-column layout, plus occasional 3rd column which features code snippets. I like this because of this 3rd "code snippets" column. It lets me write about the code in the main column, to the left of the code. As a reader/developer, I prefer this type of documentation layout, which lets me read the code, and prose explaining the code - side by side.

[Here is a great article about Slate.](https://www.bitgo.com/blog/using-openapi-at-bitgo) It's able to document API very well!  It's great for documenting any kind of code. 

The "node-slate" npm version for Node.js is easier to set up than the original Ruby tool, and has fewer dependencies. It uses [marked](https://github.com/chjj/marked) for parsing the .md, [highlight](https://highlightjs.org/) for syntax highlighting, and [Handlebars](http://handlebarsjs.com/) for templating.

Example: [http://jmanek.github.io/slate\_node](http://jmanek.github.io/slate_node/)  
Example: [https://nlp.studio](https://nlp.studio)

## [MkDocs](https://squidfunk.github.io/mkdocs-material/), [Docusaurus](https://docusaurus.io)

These tools are what make your typical 3-column layout.   
Left: site navigation  
Middle: content  
Right: navigation for the current page - click link to scroll to different section within the same page

No API reference docs, but otherwise great content and UI.

MkDocs example: [https://fastapi.tiangolo.com/](https://fastapi.tiangolo.com/)  
Docusaurus example: [https://docusaurus.io/docs/en/installation](https://docusaurus.io/docs/en/installation)

## [Jekyll](https://jekyllrb.com/)

The original tool. Uses Ruby. Supports variables. Define variables at the top of the file, and use them in the body. Seems to be very flexible. Worth a try. 





