
import { useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import "./SellerGraph.css";

function SellerNode({ data }) {
  const tone =
    data.riskStatus === "FLAGGED"
      ? "flagged"
      : data.isTarget
        ? "target"
        : "normal";

  return (
    <div className={`seller-graph-node ${tone}`}>
      <Handle type="target" position={Position.Top} />

      <strong>{data.label}</strong>
      <small>{data.sellerId}</small>

      <span>{data.riskStatus || "UNASSESSED"}</span>

      {data.verificationStatus && (
        <small>Verification: {data.verificationStatus}</small>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { seller: SellerNode };

export default function SellerGraph({ investigation }) {
  const { nodes, edges } = useMemo(() => {
    if (!investigation?.seller) {
      return { nodes: [], edges: [] };
    }

    const target = investigation.seller;
    const graph = investigation.graph || {};
    const relatedIds = graph.relatedSellerIds || [];
    const relatedSellers = graph.relatedSellers || [];
    const connections = graph.connections || [];

    const centerX = 240;
    const topY = 40;
    const verticalGap = 150;

    const graphNodes = [
      {
        id: target.sellerId,
        type: "seller",
        position: { x: centerX, y: topY },
        data: {
          label: target.displayName,
          sellerId: target.sellerId,
          riskStatus: target.riskStatus,
          verificationStatus: target.verificationStatus,
          isTarget: true,
        },
      },

      ...relatedIds.map((id, index) => {
        const relatedSeller = relatedSellers.find(
          (seller) => seller.sellerId === id
        );

        return {
          id,
          type: "seller",
          position: {
            x: index % 2 === 0 ? 30 : 450,
            y: topY + verticalGap * (index + 1),
          },
          data: {
            label: relatedSeller?.displayName || id,
            sellerId: id,
            riskStatus: relatedSeller?.riskStatus || "UNKNOWN",
            verificationStatus: relatedSeller?.verificationStatus,
            isTarget: false,
          },
        };
      }),
    ];

    const graphEdges = relatedIds.map((id) => {
      const connection = connections.find(
        (item) =>
          item.sourceSellerId === target.sellerId &&
          item.targetSellerId === id
      );

      const beneficiaryIds = connection?.sharedBeneficiaryIds || [];
      const hasEvidence =
        connection?.evidenceAvailable === true &&
        beneficiaryIds.length > 0;

      const edgeLabel = hasEvidence
        ? `Shared: ${beneficiaryIds.join(", ")}`
        : "Related seller";

      return {
        id: `${target.sellerId}-${id}`,
        source: target.sellerId,
        target: id,
        label: edgeLabel,
        animated: false,
        style: {
          stroke: connection?.flaggedConnection
            ? "#e65c70"
            : hasEvidence
              ? "#8175e8"
              : "#64748b",
          strokeWidth: 2,
        },
        labelStyle: {
          fill: "#c9c2ff",
          fontSize: 10,
        },
        labelBgStyle: {
          fill: "#101827",
          fillOpacity: 0.95,
        },
      };
    });

    return { nodes: graphNodes, edges: graphEdges };
  }, [investigation]);

  if (!investigation) return null;

  return (
    <section className="seller-graph-section">
      <div className="seller-graph-heading">
        <div>
          <h4>Seller network graph</h4>
          <p>
            Relationships are displayed using the evidence returned by the
            investigation API.
          </p>
        </div>
        <span>{nodes.length} nodes</span>
      </div>

      {nodes.length > 1 ? (
        <div className="seller-graph-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
          >
            <Background color="#29364b" gap={20} />
            <Controls />
            <MiniMap
              nodeColor={(node) =>
                node.data?.riskStatus === "FLAGGED"
                  ? "#e65c70"
                  : node.data?.isTarget
                    ? "#4b9cff"
                    : "#64748b"
              }
            />
          </ReactFlow>
        </div>
      ) : (
        <p className="muted">
          No related sellers were returned for this investigation.
        </p>
      )}

      <div className="seller-graph-legend">
        <span><i className="legend-target" /> Investigated seller</span>
        <span><i className="legend-related" /> Related seller</span>
        <span><i className="legend-flagged" /> Flagged connection</span>
      </div>

      <p className="seller-graph-disclaimer">
        A shared beneficiary or other relationship is a signal for review,
        not proof of fraud. Missing evidence is not treated as a confirmed link.
      </p>
    </section>
  );
}
