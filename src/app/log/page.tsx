import { NativeWorkspace } from "@/components/native-log/NativeWorkspace";
export const dynamic = "force-dynamic";
export default async function NativeLogPage(props: {searchParams: Promise<{date?:string;draft?:string}>}) { return <NativeWorkspace {...props}/>; }
