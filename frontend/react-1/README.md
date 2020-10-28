# React

#### Include HTML files in React app, without converting all the JSX attributes manually: [http://adrian.gaudebert.fr/blog/post/2015/12/24/how-to-include-html-in-your-react-app-with-webpack](http://adrian.gaudebert.fr/blog/post/2015/12/24/how-to-include-html-in-your-react-app-with-webpack)

Same concept, but include Markdown files, converted to HTML! Wow, amazing:   
[https://github.com/peerigon/markdown-loader](https://github.com/peerigon/markdown-loader)

## [Server-side rendering](ssr.md)

Gatsby \(compiles into static site\) vs Next.js \(dynamic SSR, and now can also compile static site\). So, it seems Next.js is superior. However, Gatsby is easier to work with. It's faster to build out the site/app. So, that should be considered. [More...](ssr.md)

## [⚠️](https://emojipedia.org/warning/) Quirks and Gotchas! [⚠️](https://emojipedia.org/warning/)

#### onClick not working, in drop-down or popup menu

Because React is "reactive", the DOM updates instantly when some data changed. So, if you change some data in the container component, onBlur, that may affect the child component \(the dropdown or popup or tooltip\). The child component may be gone before its onClick event clicked. To the human eye, it looks like the component was removed "on" click, but actually, the drop-down or popup disappeared a millisecond before the click.

