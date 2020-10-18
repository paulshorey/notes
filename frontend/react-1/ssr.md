# SSR

{% embed url="https://dev.to/vvo/how-to-solve-window-is-not-defined-errors-in-react-and-next-js-5f97" %}

First one is obvious, but there are other great tips:  
**Second point** - useEffect\(\) hooks do not load in SSR! So, put your window code there. Also, onClick\(\) and componentDidMount\(\) don't load in SSR, so they're also safe.  
**Third point** - Next supports dynamic loading of modules, in which you can turn off SSR.

## Better solution: **"shimming"** [💃](https://emojipedia.org/woman-dancing/)[🕺](https://emojipedia.org/man-dancing/)

Because even though I don't mind always wrapping my browser in a user interaction or `if (typeof window==='object') { ...`, SSR webpack will still sometimes break! **Because dependency modules may not be so diligent.**

### **In Gatsby:**

Gatsby is awesome! There is an easy plugin for everything:  
****[**https://www.gatsbyjs.com/plugins/gatsby-plugin-global-context/**](https://www.gatsbyjs.com/plugins/gatsby-plugin-global-context/)  
****Replace `kitty: true` with `window: require('ssr-window')` 

**In NextJS:**

[https://medium.com/curofy-engineering/a-guide-to-inject-variable-into-your-code-using-webpack-36c49fcc1dcd](https://medium.com/curofy-engineering/a-guide-to-inject-variable-into-your-code-using-webpack-36c49fcc1dcd)



