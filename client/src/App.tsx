import { Switch, Route } from "wouter";
import Slideshow from "./pages/Slideshow";
import Admin from "./pages/Admin";

function App() {
  return (
    <Switch>
      <Route path="/" component={Slideshow} />
      <Route path="/admin" component={Admin} />
      <Route>404 Page Not Found</Route>
    </Switch>
  );
}

export default App;
