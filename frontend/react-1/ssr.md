# SSR: debugging "window is undefined"



{% embed url="https://dev.to/vvo/how-to-solve-window-is-not-defined-errors-in-react-and-next-js-5f97" %}

First one is obvious, but there are other great tips:  
**Second point** - useEffect\(\) hooks do not load in SSR! So, put your window code there. Also, onClick\(\) and componentDidMount\(\) don't load in SSR, so they're also safe.  
**Third point** - Next supports dynamic loading of modules, in which you can turn off SSR.

## Even if you do that, your build will break! So, disable...

Because some modules are not built for SSR. So, load them only in the client:

{% embed url="https://www.gatsbyjs.com/docs/using-client-side-only-packages/" %}

## But that is still not good enough. Because, which package is it? Difficult to disable EVERY package. Now, debug...

We'll, just have to disable every package you put in since the last successful built. Still...

{% embed url="https://www.gatsbyjs.com/docs/debugging-the-build-process/" %}

```text
const { createFilePath } = require("gatsby-source-filesystem")
exports.onCreateNode = args => {
  const { actions, node } = args
  if (node.internal.type === "MarkdownRemark") {
    const { createNodeField } = actions
    const value = createFilePath({ node, getNode })
    createNodeField({
      name: `slug`,
      node,
      value,
    })
  }
}
```

`node --no-lazy --inspect-brk node_modules/.bin/gatsby develop` **Node inspector**

## That didn't work. Now what? \(following does not work...\)

I thought about setting a global "window" variable inside Webpack build process. That way, if some module mentions the window, it will be available! :\) Brilliant, right?

**In Gatsby, this is simple to do \(had to dig to find this\). Put this into 'gatsby-node.js'.**

```text
exports.onCreateWebpackConfig = ({
  plugins,
  actions,
}) => {
  actions.setWebpackConfig({
    plugins: [
      plugins.define({
        window: {document:{},location:{},navigator:{}}
      }),
    ],
  })
}
```

In Next.js, modifying webpack config is different. Look it up. But basically, put `new webpack.DefinePlugin({ yourvariable: 'your value' })` somewhere...

This does not work!!! :\( Because any plugin that tries to detect window/global backend/frontend will be broken now, because it detects a window and thinks this is the browser. But, it's not the real window, so it will try to access the DOM and stuff, and break.

## Now what?



