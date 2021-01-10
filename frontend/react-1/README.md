# React

Good resource: [https://reactresources.com/](https://reactresources.com/)

#### Include HTML files in React app, without converting all the JSX attributes manually: [http://adrian.gaudebert.fr/blog/post/2015/12/24/how-to-include-html-in-your-react-app-with-webpack](http://adrian.gaudebert.fr/blog/post/2015/12/24/how-to-include-html-in-your-react-app-with-webpack)

Same concept, but include Markdown files, converted to HTML:   
[https://github.com/peerigon/markdown-loader](https://github.com/peerigon/markdown-loader)

Good blog!  
[https://www.bitnative.com/](https://www.bitnative.com/)

## [⚠️](https://emojipedia.org/warning/) Quirks and Gotchas! [⚠️](https://emojipedia.org/warning/)

**auto-update the view after state changes**

Usually, when you pass the ...

#### onClick not working, in drop-down or popup menu

Because React is "reactive", the DOM updates instantly when some data changed. So, if you change some data in the container component, onBlur, that may affect the child component \(the dropdown or popup or tooltip\). The child component may be gone before its onClick event clicked. To the human eye, it looks like the component was removed "on" click, but actually, the drop-down or popup disappeared a millisecond before the click.

