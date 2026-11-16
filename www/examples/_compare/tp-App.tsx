import { createClient } from "@typedpress/client";
import { useQuery } from "@typedpress/client/react";

const tp = createClient({ url: import.meta.env.VITE_TP_URL });

function App() {
  const tasks = useQuery(tp.tasks.list());
  return (
    <div className="App">
      {tasks.data?.map(({ id, text }) => (
        <div key={id}>{text}</div>
      ))}
    </div>
  );
}

export default App;
