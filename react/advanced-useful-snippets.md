# Advanced Useful Snippets

**Build PropTypes declarations from object:**  
\(replace `that` with your variable\)

```text
let propTypeOf = function (value) {
    switch (value) {
      case 'function':
        return 'func';
        break;
      default:
        return typeof value;
        break;
    }
  };
  let pt = 'that: PropTypes.shape({\n';
  for (let key in that) {
    pt += `  ${key}: PropTypes.${propTypeOf(that[key])},\n`;
  }
  pt += '});';
  console.log(pt);
```



#### 

#### How to open &lt;Select /&gt; dropdown programmatically?

```text
constructor(){
     this.refSelectTld = React.createRef();
}

componentDidUpdate() {
     if (prevProps.focusSelectTld !== this.props.focusSelectTld) {
          this.DOMNode.focus();
     }
}

render(){
     return(
          <Select
               openMenuOnFocus
               ref={this.refSelectTld}
          />
     )
}
```













