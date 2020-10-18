# SSR

{% embed url="https://dev.to/vvo/how-to-solve-window-is-not-defined-errors-in-react-and-next-js-5f97" %}

First one is obvious, but there are other great tips:  
**Second point** - useEffect\(\) hooks do not load in SSR! So, put your window code there. Also, onClick\(\) and componentDidMount\(\) don't load in SSR, so they're also safe.  
**Third point** - Next supports dynamic loading of modules, in which you can turn off SSR.

## Even if you do that, your build will break!

Because some modules are not built for SSR. So, load them only in the client:

{% embed url="https://www.gatsbyjs.com/docs/using-client-side-only-packages/" %}

## But that is still not good enough. Because, which package is it? Difficult to disable EVERY package. 

Well, just have to disable every package you put in since the last successful built. Still...

{% embed url="https://www.gatsbyjs.com/docs/debugging-the-build-process/" %}

`node --no-lazy node_modules/.bin/gatsby develop --inspect-brk` 



