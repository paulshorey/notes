---
description: 'After agreeing on tabs or 2 spaces or 4 spaces, most important thing to is:'
---

# Indentation

**Make sure your text-editor or IDE does not do strange things** to your code formatting. I have found that VsCode applies strange indentation and word wrapping to all code files, on save. Surely it's possible to adjust it to behave better, but instead I chose to use Sublime Text, which by default does not modify the file on save, and otherwise pretty much the same editor.

**Prettier \(or some similar tool\) which runs after any file has changed, or in a GIT pre-commit hook, is the best option.**

**Here is a great online tool to quickly format some dirty code:**  
[**https://www.10bestdesign.com/dirtymarkup/**](https://www.10bestdesign.com/dirtymarkup/)  
This one, unlike most others, actually conforms HTML tags to a hierarchy, like this:

```text
<li>
  <a href="http://example.com/">Extensions</a>
</li>
```

While, other code formatters leave the closing tag on its own line:

```text
<li>
  <a href="http://example.com/">Extensions
  </a>
</li>
```

**Different text editors will also format the file slightly differently.** Such slight inconsistencies will get in the way of GIT "diff", GIT "merge", and just every day programming.

**Solution:**  
**1.** Use a code editor \(or editor settings\) which does not format your code by default.  
**2.** Configure a formatting tool like Prettier, using NPM, so every team member will automatically run it on file-save, or on before-commit. Agree with the team on standards,  to put into the config file `.prettierrc`. Commit that config file to version control, so all team members have it.

