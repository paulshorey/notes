# Next.js

## Get URL query parameters

#### 1\) [useRouter](https://nextjs.org/docs/api-reference/next/router#userouter)\*\*\*\*

```text
import { useRouter } from 'next/router'

export default () => {
  const router = useRouter()
  console.log(router.query);
}
```

#### 2\) Use getInitialProps in stateless component:

```text
import Link from 'next/link'
const About = ({query}) => (
  <div>Click <Link href={{ pathname: 'about', query: { name: 'leangchhean' }}}><a>here</a></Link> to read more</div>
)

About.getInitialProps = ({query}) => {
  return {query}
}

export default About;
```

#### 3\) Use getInitialProps in regular component:

```text
class About extends React.Component {

  static getInitialProps({query}) {
    return {query}
  }

  render() {
    console.log(this.props.query) // The query is available in the props object
    return <div>Click <Link href={{ pathname: 'about', query: { name: 'leangchhean' }}}><a>here</a></Link> to read more</div>

  }
}
```

The query object will be like: `url.com?a=1&b=2&c=3` becomes: `{a:1, b:2, c:3}`  
  




