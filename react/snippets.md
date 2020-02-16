# Snippets

#### How to open &lt;Select /&gt; dropdown programmatically?

```text
<Select
     openOnFocus
     ref={(ref)=>{this.DOMNode = ref}}
/>

componentDidMount() {
     if (this.props.isOpen ) {
          setTimeout(() => {
               this.DOMNode.focus();
          }, 10)
     }
}
```

"currently this work well, i describe briefly my case - huge data table, i render selects only on enter/click, any big components affect performance quite hard, so some time is good to have isOpen, thanks to author for his time and efforts"  
[https://github.com/JedWatson/react-select/issues/1989](https://github.com/JedWatson/react-select/issues/1989)







