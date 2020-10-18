# SSR

{% embed url="https://dev.to/vvo/how-to-solve-window-is-not-defined-errors-in-react-and-next-js-5f97" %}

First one is obvious, but there are other great tips:  
**Second point** - useEffect\(\) hooks do not load in SSR! So, put your window code there. Also, onClick\(\) and componentDidMount\(\) don't load in SSR, so they're also safe.  
**Third point** - Next supports dynamic loading of modules, in which you can turn off SSR.

### Read also:

[https://medium.com/curofy-engineering/a-guide-to-inject-variable-into-your-code-using-webpack-36c49fcc1dcd](https://medium.com/curofy-engineering/a-guide-to-inject-variable-into-your-code-using-webpack-36c49fcc1dcd)


