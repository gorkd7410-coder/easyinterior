// 단일 파일 빌드에서 next/dynamic 대신 쓰는 최소 대체품 (React.lazy)
import { Suspense, lazy, type ComponentType } from "react";

type Loader<P> = () => Promise<{ default: ComponentType<P> } | ComponentType<P>>;

export default function dynamic<P extends object>(loader: Loader<P>, opts?: { loading?: ComponentType; ssr?: boolean }) {
  const Lazy = lazy(async () => {
    const m = await loader();
    return { default: "default" in m ? m.default : m };
  });
  const Loading = opts?.loading;
  return function Dynamic(props: P) {
    return (
      <Suspense fallback={Loading ? <Loading /> : null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
