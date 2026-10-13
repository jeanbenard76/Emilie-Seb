import React from 'react';

export interface ChildIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

export const ChildIcon: React.FC<ChildIconProps> = ({
  size = 24,
  className = '',
  strokeWidth = 2,
  ...props
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Tête */}
      <ellipse cx="12" cy="13.2" rx="8.2" ry="8.8" />
      {/* Oreille gauche */}
      <path d="M 3.9 11.6 C 0.8 12.5 0.8 16.2 4.6 17" />
      {/* Oreille droite */}
      <path d="M 20.1 11.6 C 23.2 12.5 23.2 16.2 19.4 17" />
      {/* Mèche de cheveux / frange */}
      <path d="M 4.5 10.2 C 7.5 9.8 11 8.5 13.8 6.4 C 16.4 7.8 18 9 19.5 10.6" />
      {/* Œil gauche */}
      <circle cx="8.3" cy="13.8" r="1" fill="currentColor" stroke="none" />
      {/* Œil droit */}
      <circle cx="15.7" cy="13.8" r="1" fill="currentColor" stroke="none" />
      {/* Sourire */}
      <path d="M 9.2 17.5 C 10 19.8 14 19.8 14.8 17.5" />
    </svg>
  );
};

export default ChildIcon;
