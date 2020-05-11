# Global Variables

#### **Level: beginner, node.js**

The first paragraph brings up another interesting quirk and gotcha -- the global variable. In the browser, you have the variable `window`, properties of which are available in all included script files, without even mentioning "window.myVar". In Node.JS, you have actually two \(at least\): `process` and `global`. Process contains system properties like `process.env`, `process.exit`, etc., similar to the browser `window.location`, `window.screen`, etc. Discussion on whether or not to set your own custom properties directly onto window, or global, or process, is another topic -- covered in "anti-patterns".

