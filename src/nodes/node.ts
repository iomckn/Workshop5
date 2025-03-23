import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";
import { delay } from "../utils";

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let currentState: NodeState = {
    killed: isFaulty,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };

  const proposals: Map<number, Value[]> = new Map();
  const votes: Map<number, Value[]> = new Map();

  // Route to retrieve the current status of the node
  node.get("/status", (req, res) => {
    if (currentState.killed) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  // Route to allow the node to receive messages from other nodes
  node.post("/message", (req, res) => {
    if (!currentState.killed) {
      const { k, x, messageType } = req.body;

      if (messageType === "proposal") {
        if (!proposals.has(k)) {
          proposals.set(k, []);
        }
        proposals.get(k)!.push(x);

        if (proposals.get(k)!.length >= N - F) {
          const values = proposals.get(k)!;
          const count0 = values.filter((v) => v === 0).length;
          const count1 = values.filter((v) => v === 1).length;

          let newX: Value | "?" = "?";
          if (count0 > count1) {
            newX = 0;
          } else if (count1 > count0) {
            newX = 1;
          }

          // If all nodes propose the same value, decide immediately
          if (count0 === N - F || count1 === N - F) {
            currentState.x = newX;
            currentState.decided = true;
          } else {
            // Broadcast the new proposal
            for (let i = 0; i < N; i++) {
              fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ k, x: newX, messageType: "vote" }),
              });
            }
          }
        }
      } else if (messageType === "vote") {
        if (!votes.has(k)) {
          votes.set(k, []);
        }
        votes.get(k)!.push(x);

        if (votes.get(k)!.length >= N - F) {
          const values = votes.get(k)!;
          const count0 = values.filter((v) => v === 0).length;
          const count1 = values.filter((v) => v === 1).length;

          if (count0 > F) {
            currentState.x = 0;
            currentState.decided = true;
          } else if (count1 > F) {
            currentState.x = 1;
            currentState.decided = true;
          } else {
            if (count0 + count1 > 0 && count0 > count1) {
              currentState.x = 0;
            } else if (count0 + count1 > 0 && count1 > count0) {
              currentState.x = 1;
            } else {
              currentState.x = Math.random() > 0.5 ? 0 : 1;
            }
          }

          // Move to the next round
          currentState.k = k + 1;

          // Broadcast the new proposal for the next round
          for (let i = 0; i < N; i++) {
            fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                k: currentState.k,
                x: currentState.x,
                messageType: "proposal",
              }),
            });
          }
        }
      }

      res.status(200).send("message received");
    } else {
      res.status(400).send("node is faulty or consensus is not running");
    }
  });

  // Route to start the consensus algorithm
  node.get("/start", async (req, res) => {
    if (!nodesAreReady()) {
      res.status(400).send("not all nodes are ready");
      return;
    }

    if (currentState.killed) {
      res.status(400).send("node is faulty");
      return;
    }

    currentState.k = 1;

    // Broadcast the initial proposal
    for (let i = 0; i < N; i++) {
      fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          k: currentState.k,
          x: currentState.x,
          messageType: "proposal",
        }),
      });
    }

    res.status(200).send("consensus started");
  });

  // Route to stop the consensus algorithm
  node.get("/stop", async (req, res) => {
    currentState.killed = true;
    res.status(200).send("consensus stopped");
  });

  // Route to get the current state of a node
  node.get("/getState", (req, res) => {
    res.status(200).json(currentState);
  });

  // Start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // The node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}
