> I challenge anyone to give me a valid reason why **spaces** are better than **tabs**. I still have not heard a reason besides **"everyone uses spaces, so you should too"**. But that is a valid reason. IDE defaults, online examples, most companies' in-progress code bases usually use spaces. So, I will too. 🤐  
  
  
#### Make sure your text-editor or IDE does not do strange things  
 to your code formatting. I have found that VsCode applies strange indentation and word wrapping to all code files, on save. Surely it's possible to adjust it to behave better, but instead I chose to use Sublime Text, which by default does not modify the file on save, and otherwise pretty much the same editor. **Prettier, which runs after any file has changed, or in a GIT pre-commit hook, is the best option, especially for JSX.**  
  
[**avoid git conflicts, use .prettierrc**](https://prettier.io/docs/en/configuration.html)  
  
  
#### Here is a great online tool to quickly format some dirty code:  
[**https://www.10bestdesign.com/dirtymarkup/**](https://www.10bestdesign.com/dirtymarkup/)  
This one I've found to be the best at formatting HTML indentation. Others break it.