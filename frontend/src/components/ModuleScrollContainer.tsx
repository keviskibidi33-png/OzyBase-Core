import React from 'react';

const WIDTH_CLASS = {
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    '6xl': 'max-w-6xl',
    '7xl': 'max-w-7xl',
    full: 'max-w-none',
} as const;

type ModuleScrollWidth = keyof typeof WIDTH_CLASS;

interface ModuleScrollContainerProps {
    children: React.ReactNode;
    width?: ModuleScrollWidth;
    className?: string;
    innerClassName?: string;
}

const ModuleScrollContainer: React.FC<ModuleScrollContainerProps> = ({
    children,
    width = '6xl',
    className = '',
    innerClassName = '',
}) => (
    <div
        data-module-scroll-root
        className={`h-full overflow-y-auto overflow-x-hidden custom-scrollbar ${className}`.trim()}
    >
        <div
            className={`mx-auto min-h-full p-8 space-y-8 ${WIDTH_CLASS[width]} ${innerClassName}`.trim()}
        >
            {children}
        </div>
    </div>
);

export default ModuleScrollContainer;
