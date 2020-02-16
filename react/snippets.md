# Snippets

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













