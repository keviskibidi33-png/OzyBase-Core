# Tutorial: Build your first App with OzyBase 🚀

In this tutorial, we will build a simple **Realtime Task Manager** using React, OzyBase SDK, and TypeScript. Thanks to the "Install to Play" mode, we'll be up and running in seconds.

## 1. Setup the Backend

Ensure OzyBase is running. If you don't have a DB, just run it!

```bash
# Start OzyBase (Embedded Postgres will start automatically)
go run ./cmd/ozybase

# In another terminal, Create the collection
curl -X POST http://localhost:8090/api/collections \
  -d '{
    "name": "tasks",
    "schema": [
      {"name": "title", "type": "text", "required": true},
      {"name": "is_completed", "type": "boolean", "default": false}
    ],
    "list_rule": "public",
    "create_rule": "public"
  }'
```

## 2. Generate Types

Generate the TypeScript interfaces for your new collection:

```bash
go run ./cmd/ozybase gen-types --out ./src/types/OzyBase.ts
```

## 3. Install the SDK

In your React project:

```bash
# Install the official OzyBase SDK
npm install @OzyBase/sdk
```

## 4. Connect with React

```tsx
import React, { useEffect, useState } from 'react';
import { createClient } from '@OzyBase/sdk';
import { Database } from './types/OzyBase';

// Initialize client with generated types
const OzyBase = createClient<Database>('http://localhost:8090');

export const TaskApp = () => {
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    // 1. Fetch initial tasks
    const fetchTasks = async () => {
      const { data } = await OzyBase.from('tasks').select('*');
      if (data) setTasks(data);
    };

    fetchTasks();

    // 2. Subscribe to REALTIME updates
    const channel = OzyBase
      .channel('tasks')
      .on('INSERT', (payload) => {
        setTasks((prev) => [...prev, payload.new]);
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, []);

  const addTask = async () => {
    await OzyBase.from('tasks').insert({
      title: 'Learn OzyBase',
      is_completed: false
    });
  };

  return (
    <div>
      <h1>Tasks</h1>
      <button onClick={addTask}>Add Task</button>
      <ul>
        {tasks.map(task => (
          <li key={task.id}>{task.title}</li>
        ))}
      </ul>
    </div>
  );
};
```

## 5. Summary

You've just built a scalable, type-safe, and realtime application using **OzyBase**.

*   **Zero Config**: No database to install.
*   **Type Safety**: Your IDE now knows exactly what fields `tasks` has.
*   **Realtime**: When another user adds a task, it appears instantly.
*   **Performance**: The backend is consuming less than 30MB of RAM.

---

**Ready for more?** Check the [SDK Documentation](https://github.com/Xangel0s/-js-sdk).
