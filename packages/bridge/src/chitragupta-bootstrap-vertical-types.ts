import type {
	VerticalProfileAuthMode,
	VerticalProfilePreferredTransport,
} from "./chitragupta-vertical-contract-types.js";

/** I enumerate how bootstrap resolved the bound vertical identity. */
export const BRIDGE_BOOTSTRAP_VERTICAL_RESOLUTION_SOURCES = [
	"catalog",
	"auth-token-family",
	"explicit-vertical-id",
	"derived-consumer-prefix",
	"unbound",
] as const;
export type BridgeBootstrapVerticalResolutionSource = (typeof BRIDGE_BOOTSTRAP_VERTICAL_RESOLUTION_SOURCES)[number];

/** I capture the resolved vertical attachment identity returned by daemon bootstrap. */
export interface DaemonBridgeBootstrapVertical {
	/** I version the bootstrap vertical-attachment block. */
	contractVersion: 1;
	/** I record the resolved vertical id when one exists. */
	id: string | null;
	/** I record the resolved vertical label when one exists. */
	label: string | null;
	/** I record the resolved vertical description when one exists. */
	description: string | null;
	/** I record the preferred transport for the resolved vertical when one exists. */
	preferredTransport: VerticalProfilePreferredTransport | null;
	/** I record the auth mode for the resolved vertical when one exists. */
	authMode: VerticalProfileAuthMode | null;
	/** I record the transports the resolved vertical may legitimately use. */
	allowedTransports: VerticalProfilePreferredTransport[];
	/** I record the bundle ids exposed to the resolved vertical. */
	bundleIds: string[];
	/** I record the bound consumer id when one exists. */
	consumer: string | null;
	/** I record the bound surface when one exists. */
	surface: string | null;
	/** I record whether bootstrap resolved a canonical profile. */
	canonical: boolean;
	/** I record whether the vertical attachment identity is degraded. */
	degraded: boolean;
	/** I record how bootstrap resolved the vertical attachment identity. */
	resolutionSource: BridgeBootstrapVerticalResolutionSource;
}
