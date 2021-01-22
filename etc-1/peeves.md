# Peeves

\( 🤐 My opinion below does not matter too much! It's all about what is decided by the team. \)

* **camelCase vs. under\_scores**  
  
  It shouldn't be about which one's prettier. That is very subjective. Underscores are better because they are more consistent.  


  I want to quickly select or find any mention of "foo". That's possible with underscores. let foo, set\_foo, other\_foo; arr\[foo\]; arr\[other\_foo\]; func\(foo\); func\(other\_foo\);

  With camel-case, I have to use case-insensitive "find". Unfortunately, very often I have to turn on case sensitivity in my find/replace. Then, when doing "cmd+d" to jump to the next instance, I have to then open the find/replace menu and deselect it. That's too much work!   
  
  Also, with some very simple common variable names, I get false positives when doing case-insensitive search. It just gets in the way a lot. let foo, setFoo, otherFoo; arr\[foo\]; arr\[otherFoo\]; func\(foo\); func\(otherFoo\);

  
  With React's effects, for example, they have several utilities like useState\(\). To use it:

  ```text
  const [count, setCount] = useState(0);
  ```

  Now, I can't just search for "count", I have to search twice for "count" then again for "Count". Why not use:

  ```text
  const [count, set_count] = useState(0);
  ```

  Now I can search only once, and jump to every instance of this concept "count". Even if it's actually mentioned in multiple variable names, it's always used consistently, not sometimes capitalized, sometimes not.  

* Some programmers make a function for every new little bit of functionality, even if it's only ever used in one place. Maybe that's what they teach in a 4-year computer science degree, but from experience, I see that it gets in the way much more often than it helps. 
* Some programmers simply refuse to write comments, or if they do, write very sparse ones only because they are being forced to do it. Even if the program is amazing, which it is usually NOT, reading English is always much easier! 
* Someone assuming they're right, and refusing to try a different technique. I've been guilty of this too. 
* Unit testing 100% coverage. I'm not against unit testing 100% of functionality, if your product is stable and input/output is not changing weekly. But, some people interpret that as having to test every line of code. Please, stop. I don't care how your function came up with the data it's outputting. Just test the input/output. The internals change often, and so unit testing every bit of internal code just doubles the work you have to do for the exact same result. It doesn't accomplish anything. 
* Impostor syndrome. Do you think you're a bad programmer? not as good as your peers? don't belong in the company? about to get fired? You're probably doing just fine. Your colleagues probably respect you, or are even intimidated by you, like you are of them, because they also have impostor syndrome. Everything is fine. You're much more likely to get a raise than to get fired. 
* Intermediate syndrome. Do you think you're amazing? The best programmer in the company? Best in town? Do you think you can do anything? Then you're probably actually pretty bad. Even if you can actually create a scalable and maintainable app quickly, can anyone else read your code? Teamwork is extremely important. Some programmers are much better or much worse than others, but it's still very very difficult to built solo. A team can usually do it faster and better. So, make sure other people are able to read your code, understand it, and contribute to it. 
* 


