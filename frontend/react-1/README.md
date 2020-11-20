# React

#### Include HTML files in React app, without converting all the JSX attributes manually: [http://adrian.gaudebert.fr/blog/post/2015/12/24/how-to-include-html-in-your-react-app-with-webpack](http://adrian.gaudebert.fr/blog/post/2015/12/24/how-to-include-html-in-your-react-app-with-webpack)

Same concept, but include Markdown files, converted to HTML! Wow, amazing:   
[https://github.com/peerigon/markdown-loader](https://github.com/peerigon/markdown-loader)

## Component unmounted

Cancel all HTTP requests \(Axios, Fetch\) and setTimeouts in componentWillUnmount\(\)!   
[https://since1979.dev/cancel-axios-request-to-prevent-react-from-yelling-at-you/](https://since1979.dev/cancel-axios-request-to-prevent-react-from-yelling-at-you/)

## [Server-side rendering](ssr.md)

Gatsby \(compiles into static site\) vs Next.js \(dynamic SSR, and now can also compile static site\). So, it seems Next.js is superior. However, Gatsby is easier to work with. It's faster to build out the site/app. So, that should be considered. [More...](ssr.md)

## Optimize load times

[https://www.infoq.com/articles/reduce-react-load-time/](https://www.infoq.com/articles/reduce-react-load-time/)

## [⚠️](https://emojipedia.org/warning/) Quirks and Gotchas! [⚠️](https://emojipedia.org/warning/)

**auto-update the view after state changes**

Usually, when you pass the ...

#### onClick not working, in drop-down or popup menu

Because React is "reactive", the DOM updates instantly when some data changed. So, if you change some data in the container component, onBlur, that may affect the child component \(the dropdown or popup or tooltip\). The child component may be gone before its onClick event clicked. To the human eye, it looks like the component was removed "on" click, but actually, the drop-down or popup disappeared a millisecond before the click.

