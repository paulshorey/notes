# Code Formatting

> I challenge anyone to give me a valid reason why **spaces** are better than **tabs**. I still have not heard a reason besides **"everyone uses spaces, so you should too"**. But that is a valid reason. Most IDE defaults, online examples, companies' in-progress code bases usually use spaces. So, at my day job, I use spaces 🤐.

## Make sure your IDE does not do strange things

to your code formatting. I have found that VsCode applies strange indentation and word wrapping to all code files, on save. It uses by default an opinionated set of rules with JsBeautifier or something. Sure it's possible to adjust it, but instead I chose to use Sublime Text, which by default does not modify the file on save. I installed a plugin, **Prettier**, which runs after any file has changed, or in a GIT pre-commit hook, is **the best option, especially for JSX** \([WebStorm](webstorm.md) is even better\).

[**avoid git conflicts, use .prettierrc**](https://prettier.io/docs/en/configuration.html)

## Here is a great online tool to quickly format some dirty code:

[**https://www.10bestdesign.com/dirtymarkup/**](https://www.10bestdesign.com/dirtymarkup/)  
This one I've found to be the best at formatting HTML indentation. Others break it.

