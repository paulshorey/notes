# React

#### Include HTML files in React app, without converting all the JSX attributes manually: [http://adrian.gaudebert.fr/blog/post/2015/12/24/how-to-include-html-in-your-react-app-with-webpack](http://adrian.gaudebert.fr/blog/post/2015/12/24/how-to-include-html-in-your-react-app-with-webpack)

Same concept, but include Markdown files, converted to HTML! Wow, amazing:   
[https://github.com/peerigon/markdown-loader](https://github.com/peerigon/markdown-loader)

## [Server-side rendering](ssr.md)

Gatsby \(compiles into static site\) vs Next.js \(dynamic SSR, and now can also compile static site\). So, it seems Next.js is superior. However, Gatsby is easier to work with. It's faster to build out the site/app. So, that should be considered. [More...](ssr.md)

## [⚠️](https://emojipedia.org/warning/) Quirks and Gotchas! [⚠️](https://emojipedia.org/warning/)

**`key={'non-unique-value'}` may break, even if is child element**

I thought this only applied to the outermost container element in a `.map(` loop, but if a child elements have the same key, that can also get weird. Now, I had a left-over key attribute in a child, because I wrapped it in a container, and that was breaking the render. I simply deleted the key attribute from the child, and this fixed the problem. That was weird!

#### onClick not working, in drop-down or popup menu

Because React is "reactive", the DOM updates instantly when some data changed. So, if you change some data in the container component, onBlur, that may affect the child component \(the dropdown or popup or tooltip\). The child component may be gone before its onClick event clicked. To the human eye, it looks like the component was removed "on" click, but actually, the drop-down or popup disappeared a millisecond before the click.

