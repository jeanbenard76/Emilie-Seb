/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, useInView } from 'motion/react';
import { ChevronRight, ChevronLeft } from 'lucide-react';

// 8 Souvenir Image assets
import img1 from '../assets/images/Winner.jpg';
import img2 from '../assets/images/camping.jpeg';
import img3 from '../assets/images/mariage_amis.jpeg';
import img4 from '../assets/images/course_a_pied.jpeg';
import img5 from '../assets/images/30ans_mariages.jpg';
import img6 from '../assets/images/annecy.jpeg';
import img7 from '../assets/images/parc_naturels.jpeg';
import img8 from '../assets/images/saumur.jpeg';

interface PhotoCard {
  id: number;
  src: string;
  alt: string;
  title: string;
  caption: string;
  rotation: number;
}

const PHOTOS: PhotoCard[] = [
  {
    id: 1,
    src: img1,
    alt: "Winner",
    title: "3 mai 2025",
    caption: "",
    rotation: -3,
  },
  {
    id: 2,
    src: img2,
    alt: "Camping",
    title: "14 mai 2026",
    caption: "",
    rotation: 4,
  },
  {
    id: 3,
    src: img3,
    alt: "Mariage amis",
    title: "04 juillet 2026",
    caption: "",
    rotation: -2,
  },
  {
    id: 4,
    src: img4,
    alt: "Course à pied",
    title: "28 mars 2025",
    caption: "",
    rotation: 3,
  },
  {
    id: 5,
    src: img5,
    alt: "30 ans mariage",
    title: "19 septembre 2026",
    caption: "",
    rotation: -4,
  },
  {
    id: 6,
    src: img6,
    alt: "Annecy",
    title: "21 août 2021",
    caption: "",
    rotation: 5,
  },
  {
    id: 7,
    src: img7,
    alt: "Parcs naturels",
    title: "13 octobre 2024",
    caption: "",
    rotation: -3,
  },
  {
    id: 8,
    src: img8,
    alt: "Saumur",
    title: "18 août 2022",
    caption: "",
    rotation: 2,
  },
];

const STACK_ROTATIONS = [-3, 4, -2, 3, -4, 5, -3, 2];

export default function DynamicPhotoStack() {
  const [topIndex, setTopIndex] = useState<number>(0);
  const [isAssembled, setIsAssembled] = useState<boolean>(false);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { once: true, amount: 0.3 });

  useEffect(() => {
    if (isInView && !isAssembled) {
      // 1s delay on scroll arrival, then 8 photos fall 1 by 1 from above landing ON TOP of each other
      const timer = setTimeout(() => {
        setIsAssembled(true);
      }, 3200);
      return () => clearTimeout(timer);
    }
  }, [isInView, isAssembled]);

  const cycleToNext = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    setIsAssembled(true);
    setTopIndex((prev) => (prev + 1) % PHOTOS.length);
    setTimeout(() => {
      setIsAnimating(false);
    }, 350);
  };

  const cycleToPrev = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    setIsAssembled(true);
    setTopIndex((prev) => (prev - 1 + PHOTOS.length) % PHOTOS.length);
    setTimeout(() => {
      setIsAnimating(false);
    }, 350);
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 my-8" ref={containerRef}>
      
      {/* SECTION HEADER */}
      <div className="text-center mb-6">
        <h3 className="font-script text-[clamp(2.5rem,4.5vw,5rem)] text-[#13263B]">
          Quelques souvenirs
        </h3>
      </div>

      {/* 8 FIXED PHOTO CARDS STACK CONTAINER */}
      <div className="relative w-72 h-96 sm:w-80 sm:h-[420px] flex items-center justify-center select-none mb-6">
        {PHOTOS.map((photo, i) => {
          // Relative position in the stack: 0 = front card, 1 = 2nd card, ..., 7 = back card
          const stackPos = (i - topIndex + PHOTOS.length) % PHOTOS.length;
          const isTop = stackPos === 0;

          // Only render the top 4 cards (0, 1, 2, 3) to prevent Mobile Safari WebKit GPU memory exhaustion.
          // Cards buried 4+ layers deep are completely hidden behind the front cards.
          if (stackPos > 3) {
            return null;
          }

          // Z-Index calculations (max 30, well below top header z-[100]):
          const zIndex = 30 - stackPos * 3;

          const scale = 1 - Math.min(stackPos * 0.03, 0.18);
          const yOffset = stackPos * 6;
          const xOffset = stackPos * 2 * (photo.rotation > 0 ? 1 : -1);
          const targetRotation = STACK_ROTATIONS[stackPos];
          const initialDropRotation = i % 2 === 0 ? -12 : 12;

          const dropDelay = 1.0 + (PHOTOS.length - 1 - stackPos) * 0.22;

          return (
            <motion.div
              key={photo.id}
              style={{ zIndex }}
              className={`absolute w-full h-full bg-[#FAF7F2] border border-[#3B6FA0]/20 p-3.5 pb-12 rounded-2xl shadow-md flex flex-col justify-between touch-none ${
                isTop && isInView ? 'pointer-events-auto cursor-grab active:cursor-grabbing' : 'pointer-events-none'
              }`}
              initial={{
                y: -300,
                x: 0,
                opacity: 0,
                rotate: initialDropRotation,
                scale: 0.8,
              }}
              animate={
                isAssembled
                  ? {
                      scale,
                      y: yOffset,
                      x: isTop ? 0 : xOffset,
                      rotate: targetRotation,
                      opacity: 1,
                    }
                  : (isInView
                      ? {
                          scale,
                          y: yOffset,
                          x: isTop ? 0 : xOffset,
                          rotate: targetRotation,
                          opacity: 1,
                        }
                      : {
                          scale: 0.8,
                          y: -300,
                          x: 0,
                          rotate: initialDropRotation,
                          opacity: 0,
                        })
              }
              transition={
                isAssembled
                  ? { duration: 0.35, ease: 'easeOut' }
                  : {
                      type: 'spring',
                      stiffness: 85,
                      damping: 14,
                      delay: dropDelay,
                    }
              }
              whileHover={
                isTop
                  ? { scale: 1.03, rotate: 0, transition: { duration: 0.2 } }
                  : undefined
              }
              drag={isTop ? 'x' : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.6}
              dragSnapToOrigin={true}
              onDragEnd={(_, info) => {
                if (info.offset.x < -80 || info.velocity.x < -400) {
                  cycleToNext();
                } else if (info.offset.x > 80 || info.velocity.x > 400) {
                  cycleToPrev();
                }
              }}
            >
              {/* Photo frame */}
              <div className="relative w-full h-[78%] overflow-hidden rounded-xl border border-[#C4A475]/30 bg-white">
                <img
                  src={photo.src}
                  alt={photo.alt}
                  loading={isTop ? 'eager' : 'lazy'}
                  decoding="async"
                  className="w-full h-full object-cover pointer-events-none"
                />
              </div>

              {/* Polaroid Caption */}
              <div className="text-center pt-2 select-none flex flex-col justify-center">
                <h4 className="font-display text-[#3B6FA0] text-base font-semibold">
                  {photo.title}
                </h4>
                <p className="font-serif italic text-[#3B6FA0] text-xs">
                  {photo.caption}
                </p>
              </div>

              {/* Pin ornament */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-[#C4A475]/30 rounded-full border border-[#C4A475] shadow-2xs flex items-center justify-center">
                <div className="w-1 h-1 bg-[#13263B] rounded-full" />
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Control Buttons */}
      <div className="flex items-center gap-4 mt-2">
        <button
          onClick={cycleToPrev}
          className="p-2.5 rounded-full border border-[#3B6FA0]/20 bg-white hover:bg-[#FAF7F2] text-[#13263B] transition-all duration-300 shadow-2xs cursor-pointer"
          aria-label="Photo précédente"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <span className="font-serif italic text-xs text-[#5A5040]">
          Glissez ou cliquez pour passer à la photo suivante (8 photos)
        </span>

        <button
          onClick={cycleToNext}
          className="p-2.5 rounded-full border border-[#3B6FA0]/20 bg-[#FAF7F2] hover:bg-[#C4A475] hover:text-white text-[#13263B] transition-all duration-300 shadow-2xs cursor-pointer"
          aria-label="Photo suivante"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

    </div>
  );
}
